import type { ChecklistData } from './data';

const VIENNA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Versatz Wiens gegenüber UTC in ms zum Zeitpunkt `date` (Sommer-/Winterzeit). */
function viennaOffsetMs(date: Date): number {
  const p = Object.fromEntries(VIENNA.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return asUtc - Math.floor(date.getTime() / 60000) * 60000;
}

/** Datum ("YYYY-MM-DD") und Uhrzeit ("HH:MM") eines Zeitpunkts in Wiener Ortszeit. */
export function viennaDateParts(date: Date): { datum: string; zeit: string } {
  const p = Object.fromEntries(VIENNA.formatToParts(date).map((part) => [part.type, part.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, zeit: `${p.hour}:${p.minute}` };
}

/** "YYYY-MM-DD" + "HH:MM" in Wiener Ortszeit -> Date (UTC-Zeitpunkt), null bei ungültiger Eingabe.
 * Der Server läuft zwar mit TZ=Europe/Vienna, lokale Entwicklung und Tests aber nicht - deshalb wird die
 * Zeitzone hier explizit gerechnet statt dem Prozess-Default zu vertrauen. */
export function viennaLocalToDate(datum: string, zeit: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(zeit);
  if (!d || !t) return null;
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const first = guess - viennaOffsetMs(new Date(guess));
  return new Date(guess - viennaOffsetMs(new Date(first)));
}

export interface ChecklistColumns {
  flightAt?: Date;
  purpose: 'EINSATZ' | 'TRAINING' | null;
  area: string | null;
  pilotId: string | null;
  droneIds: string[];
}

/** Spalten, die beim Speichern zusätzlich zum JSON geschrieben werden (Listen, Filter, Rechte). */
export function deriveChecklistColumns(data: ChecklistData): ChecklistColumns {
  const flightAt = data.datum && data.zeit ? viennaLocalToDate(data.datum, data.zeit) : null;
  return {
    ...(flightAt ? { flightAt } : {}),
    purpose: data.art ? (data.art === 'Einsatz' ? 'EINSATZ' : 'TRAINING') : null,
    area: data.gebiet?.trim() || data.gemeinde?.trim() || null,
    pilotId: data.pilot || null,
    droneIds: [...new Set(data.drohnen ?? [])],
  };
}
