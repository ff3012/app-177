import { describe, expect, it } from 'vitest';
import { formatViennaDay, formatViennaIso, viennaDayOrNull, viennaWallTimeToDate } from './vienna-time';

describe('formatViennaDay', () => {
  it('nimmt den Wiener Kalendertag, nicht den UTC-Tag', () => {
    expect(formatViennaDay(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
    expect(formatViennaDay(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
  });
});

describe('formatViennaIso', () => {
  it('liefert im Sommer +02:00 und im Winter +01:00', () => {
    expect(formatViennaIso(new Date('2030-06-14T22:00:00Z'))).toBe('2030-06-15T00:00:00+02:00');
    expect(formatViennaIso(new Date('2030-01-14T23:00:00Z'))).toBe('2030-01-15T00:00:00+01:00');
  });

  it('wechselt den Offset am Sommerzeitbeginn (2030-03-31, 02:00 -> 03:00)', () => {
    expect(formatViennaIso(new Date('2030-03-31T00:59:59Z'))).toBe('2030-03-31T01:59:59+01:00');
    expect(formatViennaIso(new Date('2030-03-31T01:00:00Z'))).toBe('2030-03-31T03:00:00+02:00');
  });

  it('wechselt den Offset am Sommerzeitende (2030-10-27, 03:00 -> 02:00)', () => {
    expect(formatViennaIso(new Date('2030-10-26T23:59:59Z'))).toBe('2030-10-27T01:59:59+02:00');
    expect(formatViennaIso(new Date('2030-10-27T00:30:00Z'))).toBe('2030-10-27T02:30:00+02:00');
    expect(formatViennaIso(new Date('2030-10-27T01:30:00Z'))).toBe('2030-10-27T02:30:00+01:00');
    expect(formatViennaIso(new Date('2030-10-27T02:00:00Z'))).toBe('2030-10-27T03:00:00+01:00');
  });

  it('ist die Umkehrung von viennaWallTimeToDate und beschreibt denselben Zeitpunkt', () => {
    const d = viennaWallTimeToDate(2030, 6, 15, 19, 30, 0, 0);
    expect(formatViennaIso(d)).toBe('2030-06-15T19:30:00+02:00');
    expect(new Date(formatViennaIso(d)).getTime()).toBe(d.getTime());
  });

  it('schneidet Millisekunden ab, ohne den Tag zu verschieben', () => {
    expect(formatViennaIso(new Date('2030-06-14T21:59:59.999Z'))).toBe('2030-06-14T23:59:59+02:00');
  });
});

describe('viennaDayOrNull', () => {
  it('liefert null für fehlende Datumswerte', () => {
    expect(viennaDayOrNull(null)).toBeNull();
  });

  it('nimmt den Wiener Tag, auch wenn UTC noch am Vortag liegt (unabhängig von der Prozess-Zeitzone)', () => {
    expect(viennaDayOrNull(new Date('2027-03-28T23:00:00Z'))).toBe('2027-03-29');
  });

  it('lässt ein auf UTC-Mitternacht gespeichertes Datum (Prisma @db.Date) auf demselben Tag', () => {
    expect(viennaDayOrNull(new Date('2027-03-29T00:00:00Z'))).toBe('2027-03-29');
    expect(viennaDayOrNull(new Date('2027-07-15T00:00:00Z'))).toBe('2027-07-15');
  });
});
