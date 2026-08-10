import { prisma } from '@/lib/db/prisma';
import { resolveAudienceUserIds } from '@/lib/push/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';

export interface DispatchResult {
  sent: number;
  recipients: number;
}

/** Löst die Zielgruppe auf, versendet per Web-Push an alle registrierten Geräte und markiert die Nachricht als gesendet. Idempotent: bereits gesendete Nachrichten werden übersprungen. */
export async function dispatchNewsMessage(newsMessageId: string): Promise<DispatchResult> {
  const news = await prisma.newsMessage.findUnique({ where: { id: newsMessageId } });
  if (!news) {
    throw new Error('News-Nachricht wurde nicht gefunden.');
  }
  if (news.sentAt) {
    return { sent: 0, recipients: 0 };
  }

  const userIds = await resolveAudienceUserIds(news.audienceType, news.audienceOrgId, news.audienceDroneGroupId);
  const subscriptions = userIds.length > 0 ? await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }) : [];

  const { sent, staleIds } = await sendPushToSubscriptions(subscriptions, { title: news.title, body: news.body });

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  await prisma.newsMessage.update({ where: { id: news.id }, data: { sentAt: new Date() } });

  return { sent, recipients: subscriptions.length };
}
