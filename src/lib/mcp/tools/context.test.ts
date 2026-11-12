import { describe, expect, it } from 'vitest';
import { clampLimit, decodeCursor, denied, encodeCursor, invalid, toPage, ToolError } from './context';

describe('clampLimit', () => {
  it('Standard 25, mindestens 1, höchstens 50', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(500)).toBe(50);
  });
});

describe('Cursor', () => {
  it('trägt den Versatz hin und zurück', () => {
    expect(decodeCursor(encodeCursor(75))).toBe(75);
    expect(decodeCursor(encodeCursor(0))).toBe(0);
  });

  it('behandelt fehlende oder ungültige Cursor als Anfang', () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('###')).toBe(0);
    expect(decodeCursor(Buffer.from('-4').toString('base64url'))).toBe(0);
    expect(decodeCursor(Buffer.from('abc').toString('base64url'))).toBe(0);
  });
});

describe('toPage', () => {
  it('liefert bei Überhang eine Folgeseite und schneidet den Überhang ab', () => {
    expect(toPage([1, 2, 3], 2, 10)).toEqual({ items: [1, 2], nextCursor: encodeCursor(12) });
  });

  it('liefert ohne Überhang keine Folgeseite', () => {
    expect(toPage([1, 2], 2, 0)).toEqual({ items: [1, 2], nextCursor: null });
    expect(toPage([], 25, 0)).toEqual({ items: [], nextCursor: null });
  });
});

describe('ToolError', () => {
  it('unterscheidet Ablehnung und ungültige Eingabe', () => {
    expect(denied('x')).toBeInstanceOf(ToolError);
    expect(denied('x').kind).toBe('denied');
    expect(invalid('y').kind).toBe('invalid');
  });
});
