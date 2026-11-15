import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { getOrCreateReportKioskUser } from './report-kiosk-user';
import { submitReportCore, type SubmitReportInput, type SubmitReportResult } from './submit-report-core';

/** Höchstens 20 Abgaben pro Stunde und Link - weit über dem Bedarf eines Feuerwehrhauses, bremst nur Schleifen. */
export const KIOSK_SUBMIT_MAX = 20;
export const KIOSK_SUBMIT_WINDOW_MS = 60 * 60 * 1000;

export function kioskRateKey(token: string): string {
  return `berichte-schnell:${token}`;
}

/**
 * Abgabe über den geheimen Link, ohne Sitzung. Der Link wird bei JEDER Abgabe neu aufgelöst (ein
 * abgeschalteter oder neu erzeugter Link wirkt sofort, auch bei noch geöffneter Seite), die Feuerwehr
 * kommt ausschließlich aus dem Link. Das Limit wird erst NACH der Linkprüfung gezählt, damit ratende
 * Anfragen mit erfundenen Links keine Zähler anlegen. Die Verfügbarkeit der Berichtsart (freigeschaltet
 * und von der Feuerwehr eingeschaltet) prüft submitReportCore.
 */
export async function submitReportForKiosk(token: string, input: SubmitReportInput): Promise<SubmitReportResult> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return { error: 'Die Schnellerfassung ist nicht mehr aktiv.' };

  const limit = checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS);
  if (!limit.allowed) return { error: 'Zu viele Abgaben. Bitte später erneut versuchen.' };

  const kioskUser = await getOrCreateReportKioskUser();
  return submitReportCore({ fireDepartmentId: organization.id, createdById: kioskUser.id, input });
}
