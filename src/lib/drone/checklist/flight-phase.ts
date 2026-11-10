import type { ChecklistData } from './data';
import { viennaDateParts } from './columns';

/** "bereit" = Flug noch nicht gestartet, "laeuft" = Im Flug, "beendet" = Flug beendet (weiter mit Schritt 8). */
export type FlightPhase = 'bereit' | 'laeuft' | 'beendet';

type Flug = NonNullable<ChecklistData['fluege']>[number];

export function flightPhase(d: ChecklistData): FlightPhase {
  return d.flugStatus === 'laeuft' ? 'laeuft' : d.flugStatus === 'beendet' ? 'beendet' : 'bereit';
}

/** "Flug starten": Status auf "laeuft", die Startzeit kommt in den ersten Flug ohne Start (sonst ein neuer Flug). */
export function startFlight(d: ChecklistData, now: Date): Pick<ChecklistData, 'flugStatus' | 'flugGestartetAm' | 'fluege'> {
  const zeit = viennaDateParts(now).zeit;
  const fluege: Flug[] = [...(d.fluege ?? [])];
  const index = fluege.findIndex((f) => !f.start);
  if (index >= 0) fluege[index] = { ...fluege[index], start: zeit };
  else fluege.push({ start: zeit });
  return { flugStatus: 'laeuft', flugGestartetAm: now.toISOString(), fluege };
}

/** "Flug beenden": Status auf "beendet", die Landezeit kommt in den letzten Flug mit Start und ohne Landung. */
export function endFlight(d: ChecklistData, now: Date): Pick<ChecklistData, 'flugStatus' | 'flugBeendetAm' | 'fluege'> {
  const zeit = viennaDateParts(now).zeit;
  const fluege: Flug[] = [...(d.fluege ?? [])];
  for (let i = fluege.length - 1; i >= 0; i--) {
    if (fluege[i].start && !fluege[i].landung) {
      fluege[i] = { ...fluege[i], landung: zeit };
      break;
    }
  }
  return { flugStatus: 'beendet', flugBeendetAm: now.toISOString(), fluege };
}
