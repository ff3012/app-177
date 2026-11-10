import { describe, expect, it } from 'vitest';
import { flightSchema, parseFlightFormData } from './flight.schema';

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const base = { startsAt: '2026-06-15T10:00', pilotUserId: 'u1', location: 'Ort', droneId: 'd1', purpose: 'UEBUNG' };

describe('parseFlightFormData / flightSchema mit Checkliste', () => {
  it('übernimmt die Checklisten-Id aus dem Formular', () => {
    expect(parseFlightFormData(form({ ...base, checklistId: 'cl1' })).checklistId).toBe('cl1');
  });

  it('lässt die Checklisten-Id leer, wenn das Feld fehlt (bestehende Formulare bleiben unverändert)', () => {
    expect(parseFlightFormData(form(base)).checklistId).toBeUndefined();
  });

  it('akzeptiert Flüge mit, ohne und mit leerer Checklisten-Id', () => {
    expect(flightSchema.safeParse({ ...base, notes: '' }).success).toBe(true);
    expect(flightSchema.safeParse({ ...base, notes: '', checklistId: '' }).success).toBe(true);
    expect(flightSchema.safeParse({ ...base, notes: '', checklistId: 'cl1' }).success).toBe(true);
  });
});
