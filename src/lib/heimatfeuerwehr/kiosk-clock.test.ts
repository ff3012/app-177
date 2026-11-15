import { describe, expect, it } from 'vitest';
import { formatKioskDate, formatKioskTime } from './kiosk-clock';

// 2026-11-15 10:59 UTC = 11:59 in Wien (Winterzeit, UTC+1), ein Sonntag.
const SAMPLE = new Date('2026-11-15T10:59:00Z');

describe('Kiosk-Uhr (Wiener Zeit)', () => {
  it('formatiert die Uhrzeit als HH:MM in Wiener Zeit', () => {
    expect(formatKioskTime(SAMPLE)).toBe('11:59');
  });

  it('formatiert Wochentag, Tag, Monat und Jahr', () => {
    expect(formatKioskDate(SAMPLE)).toMatch(/^So\.?,? 15\. November 2026$/);
  });

  it('rechnet über Mitternacht in Wiener Zeit', () => {
    expect(formatKioskTime(new Date('2026-11-15T23:30:00Z'))).toBe('00:30');
    expect(formatKioskDate(new Date('2026-11-15T23:30:00Z'))).toContain('16. November 2026');
  });
});
