import webpush from 'web-push';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Push ist nicht konfiguriert (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT fehlen).');
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: { url: string };
}

interface SubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sendet an alle übergebenen Subscriptions parallel. Abgelaufene/widerrufene Subscriptions
 * (Push-Service antwortet mit 404/410) werden als staleIds zurückgegeben, damit der Aufrufer sie
 * aus der Datenbank entfernen kann - andere Fehler werden nur geloggt, brechen den Versand aber
 * nicht insgesamt ab.
 */
export async function sendPushToSubscriptions(
  subscriptions: SubscriptionRecord[],
  payload: PushPayload,
): Promise<{ sent: number; staleIds: string[] }> {
  if (subscriptions.length === 0) {
    return { sent: 0, staleIds: [] };
  }

  ensureConfigured();

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      ),
    ),
  );

  let sent = 0;
  const staleIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sent += 1;
      return;
    }
    const error = result.reason as { statusCode?: number };
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      staleIds.push(subscriptions[index].id);
    } else {
      console.error('Push-Versand an eine Subscription fehlgeschlagen:', error);
    }
  });

  return { sent, staleIds };
}
