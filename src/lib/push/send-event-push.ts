import { prisma } from '@/lib/db/prisma';
import { resolveEventAudienceUserIds } from '@/lib/push/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';

export interface EventForPush {
  id: string;
  title: string;
  startsAt: Date;
  location: string | null;
  organizationId: string;
  isSectionWide: boolean;
  category: string;
  droneGroupId: string | null;
}

/**
 * Sofort-Versand einer Push-Benachrichtigung mit Termindetails, ausgelöst von der
 * Termin-Detailseite (nicht Teil des News-Moduls - kein NewsPost-Datensatz, kein
 * sentAt-Tracking, kein Zeitplan). Zielgruppe ist dieselbe wie die Sichtbarkeit des Termins
 * selbst, siehe resolveEventAudienceUserIds. GitHub Issue #20: die Benachrichtigung trägt jetzt
 * data.url auf den konkreten Termin (statt vorher gar kein data.url, siehe public/sw.js's
 * notificationclick-Fallback auf /kalender) - bewusst weiterhin ohne NewsPost/News-Sichtbarkeit,
 * das bleibt laut Rückmeldung des App-Betreibers ein getrenntes Feature.
 */
export async function sendEventPushNow(event: EventForPush): Promise<{ sent: number; recipients: number }> {
  const userIds = await resolveEventAudienceUserIds(event);
  const subscriptions =
    userIds.length > 0 ? await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }) : [];

  const dateLabel = event.startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const body = event.location ? `${dateLabel} · ${event.location}` : dateLabel;

  const { sent, staleIds } = await sendPushToSubscriptions(subscriptions, {
    title: event.title,
    body,
    data: { url: `/kalender/${event.id}` },
  });

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { sent, recipients: subscriptions.length };
}
