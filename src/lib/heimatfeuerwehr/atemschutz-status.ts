export const FINNENTEST_WINDOW_DAYS = 365;
export const ATEMSCHUTZ_WARNING_DAYS = 30;

export type AtemschutzExpiryStatus = 'aktiv' | 'laeuft_bald_ab' | 'abgelaufen' | 'keine_angabe';

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Stichtag für den Finnentest: heute minus FINNENTEST_WINDOW_DAYS - fixe, nicht verhandelbare
 * Jahresfrist laut Vorgabe, anders als atemschutzGueltigBis (siehe schema.prisma), das ein Arzt
 * auch kürzer als 5 Jahre ansetzen kann und daher explizit gespeichert statt errechnet wird. */
export function getFinnentestCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FINNENTEST_WINDOW_DAYS);
  return cutoff;
}

/** Effektives Ablaufdatum des Finnentests: atemschutzFinnentestAm + FINNENTEST_WINDOW_DAYS - so
 * lässt sich derselbe getExpiryStatus() sowohl für die Untersuchung (atemschutzGueltigBis direkt)
 * als auch den Finnentest (dieses berechnete Datum) verwenden, statt zwei leicht unterschiedliche
 * Spezialfälle zu pflegen. */
export function getFinnentestExpiryDate(finnentestAm: Date | null): Date | null {
  return finnentestAm ? addDays(finnentestAm, FINNENTEST_WINDOW_DAYS) : null;
}

/**
 * Vereinheitlichter 3-Zustands-Status (plus "keine_angabe" wenn kein Datum erfasst ist) für ein
 * beliebiges Ablaufdatum - "läuft bald ab" innerhalb ATEMSCHUTZ_WARNING_DAYS, sonst aktiv/abgelaufen.
 * Sowohl von der Anzeige (drei Badge-Farben) als auch von der täglichen Warn-E-Mail
 * (notify-atemschutz-warnung.ts) genutzt, damit beide nie auseinanderlaufen.
 */
export function getExpiryStatus(expiryDate: Date | null): AtemschutzExpiryStatus {
  if (!expiryDate) return 'keine_angabe';
  const now = Date.now();
  if (expiryDate.getTime() <= now) return 'abgelaufen';
  const warningThreshold = now + ATEMSCHUTZ_WARNING_DAYS * 24 * 60 * 60 * 1000;
  if (expiryDate.getTime() <= warningThreshold) return 'laeuft_bald_ab';
  return 'aktiv';
}
