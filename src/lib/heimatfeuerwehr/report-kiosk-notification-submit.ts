import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS, kioskRateKey } from './report-kiosk-submit';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { submitNotificationCore, type SubmitNotificationResult } from './submit-notification-core';

/**
 * Meldung (Getränkeautomat/Schadensmeldung) über den geheimen Link, ohne Sitzung. Wie die Berichts-Abgabe: der Link wird
 * bei JEDER Abgabe neu aufgelöst, die Feuerwehr kommt ausschließlich aus dem Link, und das Limit (derselbe Zähler wie
 * bei den Berichten) wird erst NACH der Linkprüfung gezählt. Alles Übrige (Formular verfügbar, Absender, Felder) prüft
 * der Kern.
 */
export async function submitNotificationForKiosk(token: string, senderId: string, input: unknown): Promise<SubmitNotificationResult> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return { error: 'Die Schnellerfassung ist nicht mehr aktiv.' };

  const limit = checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS);
  if (!limit.allowed) return { error: 'Zu viele Abgaben. Bitte später erneut versuchen.' };

  return submitNotificationCore({ organizationId: organization.id, senderId: typeof senderId === 'string' ? senderId : '', input });
}
