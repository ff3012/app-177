import { describe, expect, it } from 'vitest';
import { calcBuffers, formatMeters } from './buffers';

describe('calcBuffers', () => {
  it('rechnet 60 m Flughöhe zu CV 6, GRB 66 und Abstand 192 (Abnahmekriterium aus dem Brief)', () => {
    expect(calcBuffers(60)).toEqual({ cv: 6, grb: 66, abstandMenschenansammlungen: 192 });
  });

  it('rechnet die Obergrenze 120 m', () => {
    expect(calcBuffers(120)).toEqual({ cv: 12, grb: 132, abstandMenschenansammlungen: 264 });
  });

  it('liefert für Höhen mit Nachkommastellen keine Gleitkomma-Artefakte', () => {
    const result = calcBuffers(33.3);
    expect(result.cv).toBeCloseTo(3.33, 10);
    expect(result.grb).toBeCloseTo(36.63, 10);
    expect(result.abstandMenschenansammlungen).toBeCloseTo(159.96, 10);
  });
});

describe('formatMeters', () => {
  it('zeigt eine Nachkommastelle mit Dezimalkomma', () => {
    expect(formatMeters(6)).toBe('6,0');
    expect(formatMeters(192)).toBe('192,0');
    expect(formatMeters(3.33)).toBe('3,3');
  });
});
