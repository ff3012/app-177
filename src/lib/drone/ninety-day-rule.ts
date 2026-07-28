export const NINETY_DAY_REQUIRED_FLIGHTS = 3;
export const NINETY_DAY_WINDOW_DAYS = 90;

/** Stichtag für die 90-Tage-Regel: heute minus NINETY_DAY_WINDOW_DAYS. */
export function getNinetyDayCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - NINETY_DAY_WINDOW_DAYS);
  return cutoff;
}

export function meetsNinetyDayRule(flightCount: number): boolean {
  return flightCount >= NINETY_DAY_REQUIRED_FLIGHTS;
}
