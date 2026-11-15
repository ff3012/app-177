'use server';

import { submitReportForKiosk } from '@/lib/heimatfeuerwehr/report-kiosk-submit';
import type { SubmitReportInput, SubmitReportResult } from '@/lib/heimatfeuerwehr/submit-report-core';
import { submitNotificationForKiosk } from '@/lib/heimatfeuerwehr/report-kiosk-notification-submit';
import type { SubmitNotificationResult } from '@/lib/heimatfeuerwehr/submit-notification-core';

/** Öffentliche Abgabe der iPad-Schnellerfassung. Bewusst OHNE requireUser(): die Prüfung (Link, Limit,
 * Zugehörigkeit aller Personen und Fahrzeuge zur Feuerwehr des Links) liegt in submitReportForKiosk. */
export async function submitReportViaKiosk(token: string, input: SubmitReportInput): Promise<SubmitReportResult> {
  return submitReportForKiosk(token, input);
}

/** Öffentliche Meldung (Getränkeautomat/Schadensmeldung) der iPad-Schnellerfassung, bewusst OHNE requireUser(). */
export async function submitNotificationViaKiosk(token: string, senderId: string, input: unknown): Promise<SubmitNotificationResult> {
  return submitNotificationForKiosk(token, senderId, input);
}
