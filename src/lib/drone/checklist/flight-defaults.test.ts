import { describe, expect, it } from 'vitest';
import { checklistToFlightDefaults } from './flight-defaults';

const base = { flightAt: new Date('2026-06-15T08:00:00Z'), data: {} };

describe('checklistToFlightDefaults', () => {
  it('übernimmt Datum und Uhrzeit in Wiener Ortszeit (Sommerzeit, UTC+2)', () => {
    expect(checklistToFlightDefaults(base).startsAt).toBe('2026-06-15T10:00');
  });

  it('übernimmt Datum und Uhrzeit in Wiener Ortszeit (Winterzeit, UTC+1)', () => {
    expect(checklistToFlightDefaults({ ...base, flightAt: new Date('2026-12-15T09:00:00Z') }).startsAt).toBe('2026-12-15T10:00');
  });

  it('rundet auf den 15-Minuten-Schritt des Flugformulars ab', () => {
    expect(checklistToFlightDefaults({ ...base, flightAt: new Date('2026-06-15T08:07:00Z') }).startsAt).toBe('2026-06-15T10:00');
    expect(checklistToFlightDefaults({ ...base, flightAt: new Date('2026-06-15T08:29:00Z') }).startsAt).toBe('2026-06-15T10:15');
    expect(checklistToFlightDefaults({ ...base, flightAt: new Date('2026-06-15T08:45:00Z') }).startsAt).toBe('2026-06-15T10:45');
  });

  it('bildet Einsatz auf EINSATZ und Training auf UEBUNG ab', () => {
    expect(checklistToFlightDefaults({ ...base, data: { art: 'Einsatz' } }).purpose).toBe('EINSATZ');
    expect(checklistToFlightDefaults({ ...base, data: { art: 'Training' } }).purpose).toBe('UEBUNG');
  });

  it('lässt den Zweck offen, wenn die Checkliste keine Art hat', () => {
    expect(checklistToFlightDefaults(base).purpose).toBeUndefined();
  });

  it('nimmt als Ort das Fluggebiet, sonst die Gemeinde', () => {
    expect(checklistToFlightDefaults({ ...base, data: { gebiet: 'Steinbruch', gemeinde: 'Gablitz' } }).location).toBe('Steinbruch');
    expect(checklistToFlightDefaults({ ...base, data: { gebiet: '  ', gemeinde: ' Gablitz ' } }).location).toBe('Gablitz');
    expect(checklistToFlightDefaults(base).location).toBeUndefined();
  });

  it('übernimmt Pilot und die erste gewählte Drohne', () => {
    const result = checklistToFlightDefaults({ ...base, data: { pilot: 'user-1', drohnen: ['d2', 'd1'] } });
    expect(result.pilotUserId).toBe('user-1');
    expect(result.droneId).toBe('d2');
  });

  it('lässt Pilot und Drohne offen, wenn nichts gewählt ist', () => {
    const result = checklistToFlightDefaults({ ...base, data: { drohnen: [] } });
    expect(result.pilotUserId).toBeUndefined();
    expect(result.droneId).toBeUndefined();
  });
});
