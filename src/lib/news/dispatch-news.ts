import { prisma } from '@/lib/db/prisma';
import { resolveNewsAudienceUserIds } from '@/lib/news/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';
import { truncateForPush } from '@/lib/news/truncate-for-push';

export interface DispatchResult {
  sent: number;
  recipients: number;
}

// truncateForPush selbst lebt in ./truncate-for-push.ts (import-frei, sicher für Client-Bundles) -
// hier nur re-exportiert, damit bestehender Code, der sie aus dispatch-news.ts importiert, weiter
// funktioniert. Neue Aufrufstellen (insbesondere aus 'use client'-Komponenten) sollten direkt aus
// truncate-for-push.ts importieren, siehe Kommentar dort.
export { truncateForPush };

/** Löst die Zielgruppe auf, versendet per Web-Push an alle registrierten Geräte (mit data.url für das
 * Sprungziel des Push-Klicks) und markiert den Beitrag als gesendet. Idempotent: bereits gesendete
 * Beiträge werden übersprungen. */
export async function dispatchNewsPost(newsPostId: string): Promise<DispatchResult> {
  const post = await prisma.newsPost.findUnique({ where: { id: newsPostId } });
  if (!post) {
    throw new Error('News-Beitrag wurde nicht gefunden.');
  }
  if (post.sentAt) {
    return { sent: 0, recipients: 0 };
  }

  const userIds = await resolveNewsAudienceUserIds(post);
  const subscriptions = userIds.length > 0 ? await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }) : [];

  const { sent, staleIds } = await sendPushToSubscriptions(subscriptions, {
    title: post.title,
    body: truncateForPush(post.body),
    data: { url: `/news/${post.id}` },
  });

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  await prisma.newsPost.update({ where: { id: post.id }, data: { sentAt: new Date() } });

  return { sent, recipients: subscriptions.length };
}
