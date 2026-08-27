import { prisma } from '@/lib/db/prisma';
import { resolveNewsAudienceUserIds } from '@/lib/news/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';
import { sendPushToFcmTokens } from '@/lib/push/fcm-client';
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
  const [subscriptions, fcmTokens] =
    userIds.length > 0
      ? await Promise.all([
          prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }),
          prisma.fcmToken.findMany({ where: { userId: { in: userIds } } }),
        ])
      : [[], []];

  const pushPayload = {
    title: post.title,
    body: truncateForPush(post.body),
    data: { url: `/news/${post.id}` },
  };

  const [webResult, fcmResult] = await Promise.all([
    sendPushToSubscriptions(subscriptions, pushPayload),
    sendPushToFcmTokens(fcmTokens, pushPayload),
  ]);

  if (webResult.staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: webResult.staleIds } } });
  }
  if (fcmResult.staleIds.length > 0) {
    await prisma.fcmToken.deleteMany({ where: { id: { in: fcmResult.staleIds } } });
  }

  await prisma.newsPost.update({ where: { id: post.id }, data: { sentAt: new Date() } });

  return { sent: webResult.sent + fcmResult.sent, recipients: subscriptions.length + fcmTokens.length };
}
