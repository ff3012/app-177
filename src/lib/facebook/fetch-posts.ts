import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const GRAPH_API_VERSION = 'v21.0';
const MAX_POST_AGE_DAYS = 90;

interface GraphApiPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url: string;
  full_picture?: string;
}

interface GraphApiPostsResponse {
  data: GraphApiPost[];
}

export interface CachedFacebookPost {
  id: string;
  message: string | null;
  createdTime: string;
  permalinkUrl: string;
  hasImage: boolean;
}

/** Holt die Beiträge einer Facebook-Seite über die Graph API und schreibt sie in FacebookPostCache;
 * Bilder werden separat in FacebookPostImage abgelegt (Bytes in Postgres, siehe Task 1) - nur für
 * tatsächlich neue Post-IDs, damit ein stündlicher Refresh nicht jedes Mal alle Bilder neu herunterlädt.
 * Wird ausschließlich vom stündlichen Cron-Endpunkt aufgerufen, nie live bei einem Seitenaufruf (Design-
 * Spec §6: "Abruf 1x pro Stunde"). */
export async function fetchAndCacheFacebookPosts(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { facebookPageId: true, facebookPageAccessToken: true },
  });
  if (!org?.facebookPageId || !org.facebookPageAccessToken) return;

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${org.facebookPageId}/posts`);
  url.searchParams.set('fields', 'message,created_time,permalink_url,full_picture');
  url.searchParams.set('access_token', org.facebookPageAccessToken);

  const response = await fetch(url.toString());
  if (!response.ok) return;
  const body = (await response.json()) as GraphApiPostsResponse;

  const cutoff = new Date(Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000);
  const recentPosts = body.data.filter((post) => new Date(post.created_time) >= cutoff);

  const posts: CachedFacebookPost[] = recentPosts.map((post) => ({
    id: post.id,
    message: post.message ?? null,
    createdTime: post.created_time,
    permalinkUrl: post.permalink_url,
    hasImage: Boolean(post.full_picture),
  }));

  // posts ist ein konkret typisiertes Array (CachedFacebookPost[]), Prisma's Json-Feld erwartet
  // strukturell InputJsonValue (Objekt mit Index-Signatur) - der Cast ist rein für den Compiler,
  // die Laufzeit-Struktur ist identisch.
  const postsJson = posts as unknown as Prisma.InputJsonValue;

  await prisma.facebookPostCache.upsert({
    where: { organizationId },
    create: { organizationId, posts: postsJson },
    update: { posts: postsJson, fetchedAt: new Date() },
  });

  const postsWithImage = recentPosts.filter((post) => post.full_picture);
  for (const post of postsWithImage) {
    const alreadyCached = await prisma.facebookPostImage.findUnique({ where: { postId: post.id } });
    if (alreadyCached) continue;

    try {
      const imageResponse = await fetch(post.full_picture!);
      if (!imageResponse.ok) continue;
      const mimeType = imageResponse.headers.get('content-type') ?? 'image/jpeg';
      const data = Buffer.from(await imageResponse.arrayBuffer());
      await prisma.facebookPostImage.create({ data: { postId: post.id, data, mimeType } });
    } catch {
      // Ein einzelnes fehlgeschlagenes Bild darf den restlichen Cache-Refresh nicht abbrechen.
      continue;
    }
  }
}
