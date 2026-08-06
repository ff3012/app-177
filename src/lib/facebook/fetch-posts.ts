import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const GRAPH_API_VERSION = 'v26.0';
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

interface GraphApiErrorResponse {
  error?: { message?: string; type?: string; code?: number };
}

export interface CachedFacebookPost {
  id: string;
  message: string | null;
  createdTime: string;
  permalinkUrl: string;
  hasImage: boolean;
}

async function markFetchResult(organizationId: string, error: string | null): Promise<void> {
  await prisma.organization
    .update({
      where: { id: organizationId },
      data: { facebookLastFetchAt: new Date(), facebookLastFetchError: error },
    })
    .catch((updateError) => {
      console.error('Konnte facebookLastFetchAt/-Error nicht aktualisieren:', updateError);
    });
}

/** Holt die Beiträge einer Facebook-Seite über die Graph API und schreibt sie in FacebookPostCache;
 * Bilder werden separat in FacebookPostImage abgelegt (Bytes in Postgres, siehe Task 1) - nur für
 * tatsächlich neue Post-IDs, damit ein stündlicher Refresh nicht jedes Mal alle Bilder neu herunterlädt.
 * Wird ausschließlich vom stündlichen Cron-Endpunkt aufgerufen, nie live bei einem Seitenaufruf (Design-
 * Spec §6: "Abruf 1x pro Stunde").
 *
 * Wirft nie - jeder Fehler (Netzwerk, ein von Graph zurückgegebener Fehlerstatus, Token abgelaufen
 * etc.) wird in Organization.facebookLastFetchError geschrieben statt stillschweigend zu verschwinden
 * (echter Produktionsfall: der Cron-Endpunkt selbst lief jede Stunde erfolgreich durch, meldete aber
 * nichts darüber, ob der Graph-API-Aufruf DAHINTER auch tatsächlich geklappt hat - siehe CLAUDE.md). */
export async function fetchAndCacheFacebookPosts(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { facebookPageId: true, facebookPageAccessToken: true },
  });
  if (!org?.facebookPageId || !org.facebookPageAccessToken) return;

  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${org.facebookPageId}/posts`);
    url.searchParams.set('fields', 'message,created_time,permalink_url,full_picture');
    url.searchParams.set('access_token', org.facebookPageAccessToken);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as GraphApiErrorResponse | null;
      throw new Error(errorBody?.error?.message ?? `Facebook Graph API antwortete mit Status ${response.status}`);
    }
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

    // FacebookPostImage hat KEINE organizationId-Spalte - eine naive "lösche alles, was nicht in
    // recentPosts steht" würde bei mehreren Organisationen im selben Cron-Lauf versehentlich das
    // Bild einer ANDEREN, noch gültigen Organisation löschen. Graph-API-Post-IDs haben immer die
    // Form `{page-id}_{story-id}`, also wird zusätzlich auf das eigene facebookPageId-Präfix
    // gescoped, um nur Bilder dieser Organisation zu treffen. Läuft vor dem Bild-Download-Loop,
    // damit ein gerade erst wieder als "recent" erkannter Post hier nicht gelöscht und im selben
    // Aufruf neu heruntergeladen werden müsste.
    const recentPostIds = recentPosts.map((post) => post.id);
    await prisma.facebookPostImage.deleteMany({
      where: {
        AND: [{ postId: { startsWith: `${org.facebookPageId}_` } }, { postId: { notIn: recentPostIds } }],
      },
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

    await markFetchResult(organizationId, null);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unbekannter Fehler beim Facebook-Abruf.';
    console.error(`Facebook-Post-Abruf fehlgeschlagen (Organization ${organizationId}):`, error);
    await markFetchResult(organizationId, message);
  }
}
