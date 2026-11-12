import { describe, expect, it } from 'vitest';
import { parseRange } from './drone';

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

  it('liest ISO-Zeitpunkte ohne Zeitzone als Wiener Ortszeit, nicht als Serverzeit', () => {
    expect(parseRange('2026-07-01T10:00', '2026-07-02').from.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(parseRange('2026-01-15T10:00:30.5', '2026-01-16').from.toISOString()).toBe('2026-01-15T09:00:30.500Z');
    expect(parseRange('2026-07-01T10:00:00+05:00', '2026-07-02').from.toISOString()).toBe('2026-07-01T05:00:00.000Z');
  });

  it('lehnt unmögliche Zeitpunkte und freie Datumsformate ab', () => {
    expect(() => parseRange('2026-07-01T25:00', '2026-07-02')).toThrow(/Ungültiges Datum/);
    expect(() => parseRange('March 1 2026', '2026-07-02')).toThrow(/Ungültiges Datum/);
  });

  it('lehnt unmögliche Daten, vertauschte Grenzen und zu lange Zeiträume ab', () => {
    expect(() => parseRange('2026-02-31', '2026-03-01')).toThrow(/Ungültiges Datum/);
    expect(() => parseRange('kaputt', '2026-03-01')).toThrow(/Ungültiges Datum/);
    expect(() => parseRange('2026-03-02', '2026-03-01')).toThrow(/vor/);
    expect(() => parseRange('2025-01-01', '2026-06-01')).toThrow(/366/);
  });
});
