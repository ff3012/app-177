import { prisma } from '@/lib/db/prisma';
import { resolveNewsAudienceUserIds } from '@/lib/news/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';

export interface DispatchResult {
  sent: number;
  recipients: number;
}

const PUSH_TRUNCATE_LENGTH = 170;

/** Kürzt an der letzten Wortgrenze vor maxLength (nie mitten im Wort) und hängt eine Ellipse an - die
 * volle Nutzlast würde bei langen Texten das 4-KB-Payload-Limit von Web Push riskieren, und ein
 * Abschneiden mitten im Wort sähe auf dem Sperrbildschirm kaputt aus. */
export function truncateForPush(body: string, maxLength = PUSH_TRUNCATE_LENGTH): string {
  if (body.length <= maxLength) return body;
  const cut = body.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

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
