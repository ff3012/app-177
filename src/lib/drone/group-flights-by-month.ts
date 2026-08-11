const MONTH_LABELS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export interface FlightMonthGroup<T> {
  key: string;
  label: string;
  flights: T[];
}

/**
 * flights muss bereits chronologisch sortiert sein (absteigend, neueste zuerst - wie die Flugbuch-
 * Query sie liefert) - hier nur noch nach Jahr+Monat in aufeinanderfolgende Gruppen zusammengefasst,
 * ohne erneut zu sortieren. Generisch über T (statt an einen konkreten FlightRow-Typ gebunden),
 * damit diese Datei keine Abhängigkeit auf Task 3's Zeilentyp braucht - nur `startsAt: Date` wird
 * vorausgesetzt. Ein Monat ohne Flüge taucht hier nie auf: die Funktion erzeugt Gruppen nur für
 * Monate, die tatsächlich mindestens einen der übergebenen (bereits gefilterten) Flüge enthalten.
 */
export function groupFlightsByMonth<T extends { startsAt: Date }>(flights: T[]): FlightMonthGroup<T>[] {
  const groups: FlightMonthGroup<T>[] = [];
  for (const flight of flights) {
    const key = `${flight.startsAt.getFullYear()}-${flight.startsAt.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.flights.push(flight);
    } else {
      groups.push({
        key,
        label: `${MONTH_LABELS[flight.startsAt.getMonth()]} ${flight.startsAt.getFullYear()}`,
        flights: [flight],
      });
    }
  }
  return groups;
}
