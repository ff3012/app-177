import type { ChecklistData } from './data';

export interface FlightDefaults {
  startsAt: string;
  purpose?: 'EINSATZ' | 'UEBUNG';
  pilotUserId?: string;
  location?: string;
  droneId?: string;
}

const VIENNA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "YYYY-MM-DDTHH:mm" in Wiener Ortszeit, auf den 15-Minuten-Schritt des Flugformulars abgerundet
 * (DateTime15MinInput bietet nur :00/:15/:30/:45 an - eine andere Minute bliebe dort leer). */
function viennaQuarterHour(date: Date): string {
  const parts = Object.fromEntries(VIENNA.formatToParts(date).map((p) => [p.type, p.value]));
  const minute = String(Math.floor(Number(parts.minute) / 15) * 15).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${minute}`;
}

/** Vorbelegung des Flugformulars aus einer Checkliste. Felder ohne Wert fehlen im Ergebnis, damit die
 * Standardwerte des Formulars bestehen bleiben. */
export function checklistToFlightDefaults(checklist: { flightAt: Date; data: ChecklistData }): FlightDefaults {
  const { data } = checklist;
  const result: FlightDefaults = { startsAt: viennaQuarterHour(checklist.flightAt) };
  if (data.art) result.purpose = data.art === 'Einsatz' ? 'EINSATZ' : 'UEBUNG';
  if (data.pilot) result.pilotUserId = data.pilot;
  const location = data.gebiet?.trim() || data.gemeinde?.trim();
  if (location) result.location = location;
  if (data.drohnen?.[0]) result.droneId = data.drohnen[0];
  return result;
}
