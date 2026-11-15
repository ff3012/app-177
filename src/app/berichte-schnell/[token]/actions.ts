'use server';

import { submitReportForKiosk } from '@/lib/heimatfeuerwehr/report-kiosk-submit';
import type { SubmitReportInput, SubmitReportResult } from '@/lib/heimatfeuerwehr/submit-report-core';

/** Öffentliche Abgabe der iPad-Schnellerfassung. Bewusst OHNE requireUser(): die Prüfung (Link, Limit,
 * Zugehörigkeit aller Personen und Fahrzeuge zur Feuerwehr des Links) liegt in submitReportForKiosk. */
export async function submitReportViaKiosk(token: string, input: SubmitReportInput): Promise<SubmitReportResult> {
  return submitReportForKiosk(token, input);
}
