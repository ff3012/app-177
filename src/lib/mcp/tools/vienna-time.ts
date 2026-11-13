const VIENNA = 'Europe/Vienna';

const viennaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VIENNA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Versatz von Europe/Vienna gegenüber UTC (in ms) zum gegebenen Zeitpunkt. */
export function viennaOffsetMs(at: Date): number {
  const p = Object.fromEntries(viennaParts.formatToParts(at).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wandzeit in Europe/Vienna -> Zeitpunkt (unabhängig von der Server-Zeitzone, auch über Sommerzeitgrenzen). */
export function viennaWallTimeToDate(y: number, m: number, d: number, h: number, min: number, s: number, ms: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min, s, ms);
  const first = guess - viennaOffsetMs(new Date(guess));
  return new Date(guess - viennaOffsetMs(new Date(first)));
}

/** Kalendertag `YYYY-MM-DD` in Europe/Vienna (nie über UTC, sonst rutscht ein Tag um Mitternacht). */
export function formatViennaDay(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: VIENNA });
}

/**
 * Wiener Ortszeit als ISO-8601 mit Offset, z. B. `2030-06-15T00:00:00+02:00` (Sekundengenauigkeit).
 * Der Offset ist sommerzeitkorrekt (+01:00 im Winter, +02:00 im Sommer).
 */
export function formatViennaIso(date: Date): string {
  const offset = viennaOffsetMs(date);
  const local = new Date(Math.floor(date.getTime() / 1000) * 1000 + offset);
  const base = local.toISOString().slice(0, 19); // local trägt hier die Wiener Wandzeit als UTC-Felder
  const minutes = Math.round(offset / 60000);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${base}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Wie `formatViennaDay`, für optionale Datumsfelder (Kalendertage ohne Uhrzeit, z. B. Untersuchungsdatum). */
export const viennaDayOrNull = (date: Date | null): string | null => (date ? formatViennaDay(date) : null);
