import { describe, expect, it } from 'vitest';
import { generateReportKioskToken, isPlausibleReportKioskToken } from './report-kiosk-token';

describe('generateReportKioskToken', () => {
  it('liefert 32 URL-sichere Zeichen', () => {
    expect(generateReportKioskToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('liefert bei jedem Aufruf einen anderen Wert', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateReportKioskToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('isPlausibleReportKioskToken', () => {
  it('akzeptiert einen erzeugten Token', () => {
    expect(isPlausibleReportKioskToken(generateReportKioskToken())).toBe(true);
  });

  it.each(['', 'kurz', 'a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(31)}!`, `${'a'.repeat(31)} `])(
    'lehnt %j ab',
    (value) => {
      expect(isPlausibleReportKioskToken(value)).toBe(false);
    },
  );
});
