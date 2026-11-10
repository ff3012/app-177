import { describe, expect, it } from 'vitest';
import { checklistDataSchema } from './data';
import { endFlight, flightPhase, startFlight } from './flight-phase';

// 2026-11-10 14:05 Wiener Zeit (MEZ = UTC+1)
const NOW = new Date('2026-11-10T13:05:00Z');

describe('flightPhase', () => {
  it('ist "bereit", solange kein Flug gestartet wurde (auch bei älteren Entwürfen)', () => {
    expect(flightPhase({})).toBe('bereit');
    expect(flightPhase({ fluege: [{ start: '10:00', landung: '10:20' }] })).toBe('bereit');
  });

  it('übernimmt laeuft und beendet aus den Daten', () => {
    expect(flightPhase({ flugStatus: 'laeuft' })).toBe('laeuft');
    expect(flightPhase({ flugStatus: 'beendet' })).toBe('beendet');
  });

  it('bleibt nach dem Speichern erhalten (Schema entfernt die Felder nicht)', () => {
    const parsed = checklistDataSchema.parse({ flugStatus: 'laeuft', flugGestartetAm: NOW.toISOString(), flugBeendetAm: NOW.toISOString() });
    expect(parsed.flugStatus).toBe('laeuft');
    expect(parsed.flugGestartetAm).toBe(NOW.toISOString());
    expect(parsed.flugBeendetAm).toBe(NOW.toISOString());
  });
});

describe('startFlight', () => {
  it('setzt den Status und trägt die Startzeit im ersten Flug ohne Start ein', () => {
    const patch = startFlight({}, NOW);
    expect(patch.flugStatus).toBe('laeuft');
    expect(patch.flugGestartetAm).toBe(NOW.toISOString());
    expect(patch.fluege).toEqual([{ start: '14:05' }]);
  });

  it('füllt den ersten Flug ohne Start und lässt bestehende Eingaben unberührt', () => {
    const patch = startFlight({ fluege: [{ akku: 'A1', start: '09:00', landung: '09:15' }, { akku: 'A2' }] }, NOW);
    expect(patch.fluege).toEqual([{ akku: 'A1', start: '09:00', landung: '09:15' }, { akku: 'A2', start: '14:05' }]);
  });

  it('legt keinen weiteren Flug an, wenn alle vorhandenen Flüge schon eine Startzeit haben', () => {
    const fluege = [{ akku: '1', start: '09:00', landung: '09:15' }];
    const patch = startFlight({ fluege }, NOW);
    expect(patch.fluege).toEqual(fluege);
    expect(patch.flugStatus).toBe('laeuft');
    expect(patch.flugGestartetAm).toBe(NOW.toISOString());
  });
});

describe('endFlight', () => {
  it('setzt den Status und trägt die Landezeit im letzten Flug mit Start und ohne Landung ein', () => {
    const patch = endFlight({ flugStatus: 'laeuft', fluege: [{ start: '09:00', landung: '09:15' }, { start: '14:00' }] }, NOW);
    expect(patch.flugStatus).toBe('beendet');
    expect(patch.flugBeendetAm).toBe(NOW.toISOString());
    expect(patch.fluege).toEqual([{ start: '09:00', landung: '09:15' }, { start: '14:00', landung: '14:05' }]);
  });

  it('überschreibt keine bereits eingetragene Landezeit', () => {
    const patch = endFlight({ fluege: [{ start: '14:00', landung: '14:03' }] }, NOW);
    expect(patch.fluege).toEqual([{ start: '14:00', landung: '14:03' }]);
  });

  it('lässt die Flüge unverändert, wenn keiner eine Startzeit hat', () => {
    const patch = endFlight({ fluege: [{ akku: 'A1' }] }, NOW);
    expect(patch.fluege).toEqual([{ akku: 'A1' }]);
    expect(patch.flugStatus).toBe('beendet');
  });
});
