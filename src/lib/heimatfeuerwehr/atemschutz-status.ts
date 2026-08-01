export const FINNENTEST_WINDOW_DAYS = 365;

/** Stichtag für den Finnentest: heute minus FINNENTEST_WINDOW_DAYS - fixe, nicht verhandelbare
 * Jahresfrist laut Vorgabe, anders als atemschutzGueltigBis (siehe schema.prisma), das ein Arzt
 * auch kürzer als 5 Jahre ansetzen kann und daher explizit gespeichert statt errechnet wird. */
export function getFinnentestCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FINNENTEST_WINDOW_DAYS);
  return cutoff;
}

export function isUntersuchungActive(gueltigBis: Date | null): boolean {
  return gueltigBis !== null && gueltigBis.getTime() > Date.now();
}

export function isFinnentestActive(finnentestAm: Date | null): boolean {
  return finnentestAm !== null && finnentestAm.getTime() > getFinnentestCutoff().getTime();
}
