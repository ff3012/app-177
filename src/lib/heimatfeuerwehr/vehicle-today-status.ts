export type VehicleTodayStatus =
  | { kind: 'frei' }
  | { kind: 'ab'; time: Date }
  | { kind: 'bis'; time: Date }
  | { kind: 'belegt' };

/**
 * Fahrzeug-Status "für heute" (Fahrzeug-reservieren-Brief.md §2) - reine, testbare Funktion statt
 * inline in der Seite berechnet. `bookings` müssen bereits auf den relevanten Ausschnitt gefiltert
 * sein (`startsAt < endOfToday && endsAt > now`, nicht ABGELEHNT - siehe die Prisma-Query am
 * Aufrufer) und müssen NICHT vorsortiert sein, das übernimmt diese Funktion selbst.
 *
 * - Keine Buchungen im Fenster -> "frei".
 * - Aktuell keine laufende Buchung, aber eine künftige heute -> "ab {Start der nächsten Buchung}".
 * - Aktuell eine laufende Buchung -> deren Ende ermitteln, dabei RÜCKENANSCHLIESSENDE/überlappende
 *   Folgebuchungen mit einrechnen (mehrere Buchungen ohne Lücke zählen als EIN durchgehender
 *   belegter Block) -> "bis {Ende des zusammengeführten Blocks}", oder "belegt" wenn dieser Block
 *   bis mindestens Tagesende reicht.
 */
export function computeVehicleTodayStatus(
  bookings: { startsAt: Date; endsAt: Date }[],
  now: Date,
  endOfToday: Date,
): VehicleTodayStatus {
  if (bookings.length === 0) return { kind: 'frei' };

  const sorted = [...bookings].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const current = sorted.find((b) => b.startsAt <= now && b.endsAt > now);

  if (!current) {
    // Nicht aktuell belegt - die früheste künftige Buchung im Fenster bestimmt "ab wann".
    return { kind: 'ab', time: sorted[0].startsAt };
  }

  // Aktuell belegt - vorwärts durch lückenlos anschließende/überlappende Buchungen zusammenführen,
  // um das tatsächliche Ende des durchgehenden belegten Blocks zu finden.
  let mergedEnd = current.endsAt;
  let extended = true;
  while (extended) {
    extended = false;
    for (const b of sorted) {
      if (b.startsAt <= mergedEnd && b.endsAt > mergedEnd) {
        mergedEnd = b.endsAt;
        extended = true;
      }
    }
  }

  if (mergedEnd >= endOfToday) return { kind: 'belegt' };
  return { kind: 'bis', time: mergedEnd };
}
