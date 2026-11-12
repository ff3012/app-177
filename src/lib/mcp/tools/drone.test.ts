import { describe, expect, it } from 'vitest';
import { formatViennaDay, parseRange } from './drone';

describe('parseRange', () => {
  it('nimmt Datumsangaben als Wiener Tagesgrenzen (Sommerzeit)', () => {
    const range = parseRange('2026-07-01', '2026-07-01');
    expect(range.from.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-07-01T21:59:59.999Z');
  });

  it('nimmt Datumsangaben als Wiener Tagesgrenzen (Winterzeit)', () => {
    const range = parseRange('2026-01-15', '2026-01-15');
    expect(range.from.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-01-15T22:59:59.999Z');
  });

  it('übernimmt ISO-Zeitpunkte unverändert', () => {
    expect(parseRange('2026-03-01T10:00:00Z', '2026-03-02T10:00:00Z').from.toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });

  it('lehnt unmögliche Daten, vertauschte Grenzen und zu lange Zeiträume ab', () => {
    expect(() => parseRange('2026-02-31', '2026-03-01')).toThrow(/Ungültiges Datum/);
    expect(() => parseRange('kaputt', '2026-03-01')).toThrow(/Ungültiges Datum/);
    expect(() => parseRange('2026-03-02', '2026-03-01')).toThrow(/vor/);
    expect(() => parseRange('2025-01-01', '2026-06-01')).toThrow(/366/);
  });
});

describe('formatViennaDay', () => {
  it('formatiert in Wiener Zeit, nicht in UTC', () => {
    expect(formatViennaDay(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
    expect(formatViennaDay(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
  });
});
