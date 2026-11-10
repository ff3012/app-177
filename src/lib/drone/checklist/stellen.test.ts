import { describe, expect, it } from 'vitest';
import { checklistDataSchema } from './data';
import { STELLEN_OPTIONS, stellenText } from './labels';

describe('Zuständige Stellen (Nr. 7)', () => {
  it('bietet genau die drei festen Stellen an', () => {
    expect(STELLEN_OPTIONS.map((o) => o.label)).toEqual(['AustroControl DroneSpace', 'ÖAMTC', 'Funk HS-OST']);
  });

  it('akzeptiert eine Mehrfachauswahl samt Freitext "Weitere"', () => {
    const result = checklistDataSchema.safeParse({ stellenAuswahl: ['acg', 'hsost'], stellen: 'Polizei' });
    expect(result.success).toBe(true);
  });

  it('lehnt unbekannte Stellen ab', () => {
    expect(checklistDataSchema.safeParse({ stellenAuswahl: ['acg', 'ufo'] }).success).toBe(false);
  });

  it('übernimmt einen früher gespeicherten Freitext unverändert als "Weitere"', () => {
    const result = checklistDataSchema.safeParse({ stellen: 'Ja' });
    expect(result.success && result.data.stellen).toBe('Ja');
  });

  it('formuliert Auswahl und Freitext für PDF und Mail', () => {
    expect(stellenText({ stellenAuswahl: ['acg', 'oeamtc'], stellen: 'Polizei' })).toBe('AustroControl DroneSpace, ÖAMTC, Weitere: Polizei');
    expect(stellenText({ stellenAuswahl: ['hsost'] })).toBe('Funk HS-OST');
    expect(stellenText({ stellen: '  Bergrettung ' })).toBe('Weitere: Bergrettung');
  });

  it('zeigt einen Strich, wenn nichts gewählt wurde', () => {
    expect(stellenText({})).toBe('-');
    expect(stellenText({ stellenAuswahl: [], stellen: '   ' })).toBe('-');
  });

  it('behält die Reihenfolge der Optionen, nicht die der Auswahl', () => {
    expect(stellenText({ stellenAuswahl: ['hsost', 'acg'] })).toBe('AustroControl DroneSpace, Funk HS-OST');
  });
});
