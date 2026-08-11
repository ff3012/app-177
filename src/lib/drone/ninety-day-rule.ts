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

/**
 * Bis wann die Regel ohne einen weiteren Flug erfüllt bleibt: die Regel bricht erst, sobald der
 * NINETY_DAY_REQUIRED_FLIGHTS-neueste (noch mitgezählte) Flug aus dem 90-Tage-Fenster fällt - also
 * 90 Tage nach dessen Datum. `flightDatesDesc` muss bereits auf das aktuelle Fenster gefiltert und
 * absteigend (neuester zuerst) sortiert sein. Gibt null zurück, wenn die Regel aktuell nicht erfüllt
 * ist (weniger als NINETY_DAY_REQUIRED_FLIGHTS Flüge im Fenster).
 */
export function getComplianceUntilDate(flightDatesDesc: Date[]): Date | null {
  if (flightDatesDesc.length < NINETY_DAY_REQUIRED_FLIGHTS) return null;
  const criticalFlight = flightDatesDesc[NINETY_DAY_REQUIRED_FLIGHTS - 1];
  const until = new Date(criticalFlight);
  until.setDate(until.getDate() + NINETY_DAY_WINDOW_DAYS);
  return until;
}

/**
 * Tage bis zum Ablauf der 90-Tage-Regel (siehe getComplianceUntilDate), gerundet auf ganze Tage.
 * null, wenn die Regel aktuell nicht erfüllt ist - dieselbe Bedeutung wie getComplianceUntilDate's
 * eigener null-Fall, hier nur als Zahl statt als Datum, für die Bernstein-Schwelle in der neuen
 * Gruppenstatus-Balkenliste (<= 14 Tage = Bernstein statt Grün).
 */
export function getDaysUntilExpiry(flightDatesDesc: Date[]): number | null {
  const until = getComplianceUntilDate(flightDatesDesc);
  if (!until) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((until.getTime() - Date.now()) / msPerDay);
}
