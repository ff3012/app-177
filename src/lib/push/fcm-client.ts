import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { PushPayload } from './web-push-client';

let app: App | undefined;

/** Configured on first use, same as web-push-client.ts's ensureConfigured() (there for VAPID
 * details via webpush.setVapidDetails, here for the Firebase Admin app instance) - not at module
 * load, so a missing FIREBASE_SERVICE_ACCOUNT_JSON only breaks native push sends, never anything
 * that merely imports this file. */
function ensureConfigured(): App {
  if (app) return app;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Push ist nicht konfiguriert (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).');
  }

  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }

  const serviceAccount = JSON.parse(raw);
  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

interface FcmTokenRecord {
  id: string;
  token: string;
}

/**
 * Sendet an alle übergebenen FCM-Tokens parallel - dieselbe Struktur wie
 * web-push-client.ts's sendPushToSubscriptions, damit beide Sendewege von den Aufrufern (News,
 * Kalender-Push) identisch behandelt werden können. Ungültige/nicht mehr registrierte Tokens
 * (FCM antwortet mit dem Fehlercode 'messaging/registration-token-not-registered') werden als
 * staleIds zurückgegeben, andere Fehler werden nur geloggt.
 */
export async function sendPushToFcmTokens(
  tokens: FcmTokenRecord[],
  payload: PushPayload,
): Promise<{ sent: number; staleIds: string[] }> {
  if (tokens.length === 0) {
    return { sent: 0, staleIds: [] };
  }

  const messaging = getMessaging(ensureConfigured());

  const results = await Promise.allSettled(
    tokens.map((t) =>
      messaging.send({
        token: t.token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ? { url: payload.data.url } : undefined,
      }),
    ),
  );

  let sent = 0;
  const staleIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sent += 1;
      return;
    }
    const error = result.reason as { code?: string };
    if (error?.code === 'messaging/registration-token-not-registered') {
      staleIds.push(tokens[index].id);
    } else {
      console.error('FCM-Push-Versand an ein Token fehlgeschlagen:', error);
    }
  });

  return { sent, staleIds };
}
