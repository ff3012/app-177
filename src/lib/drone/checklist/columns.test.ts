import { describe, expect, it } from 'vitest';
import { deriveChecklistColumns, viennaDateParts, viennaLocalToDate } from './columns';

describe('viennaLocalToDate', () => {
  it('wandelt Sommerzeit (UTC+2) nach UTC', () => {
    expect(viennaLocalToDate('2026-06-15', '10:00')?.toISOString()).toBe('2026-06-15T08:00:00.000Z');
  });

  it('wandelt Winterzeit (UTC+1) nach UTC', () => {
    expect(viennaLocalToDate('2026-12-15', '10:00')?.toISOString()).toBe('2026-12-15T09:00:00.000Z');
  });

  it('trifft die Zeitumstellung: 29.03.2026 03:00 ist bereits Sommerzeit', () => {
    expect(viennaLocalToDate('2026-03-29', '03:00')?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('liefert null für ungültige Eingaben', () => {
    expect(viennaLocalToDate('', '10:00')).toBeNull();
    expect(viennaLocalToDate('2026-06-15', '')).toBeNull();
    expect(viennaLocalToDate('15.06.2026', '10:00')).toBeNull();
    expect(viennaLocalToDate('2026-06-15', '25:99')).toBeNull();
  });
});

describe('deriveChecklistColumns', () => {
  it('leitet Zweck aus der Art ab', () => {
    expect(deriveChecklistColumns({ art: 'Einsatz' }).purpose).toBe('EINSATZ');
    expect(deriveChecklistColumns({ art: 'Training' }).purpose).toBe('TRAINING');
    expect(deriveChecklistColumns({}).purpose).toBeNull();
  });

  it('nimmt als Gebiet das Fluggebiet, sonst die Gemeinde, sonst null', () => {
    expect(deriveChecklistColumns({ gebiet: ' Steinbruch ', gemeinde: 'Gablitz' }).area).toBe('Steinbruch');
    expect(deriveChecklistColumns({ gebiet: '', gemeinde: 'Gablitz' }).area).toBe('Gablitz');
    expect(deriveChecklistColumns({}).area).toBeNull();
  });

  it('übernimmt den Piloten, leer wird null', () => {
    expect(deriveChecklistColumns({ pilot: 'u1' }).pilotId).toBe('u1');
    expect(deriveChecklistColumns({ pilot: '' }).pilotId).toBeNull();
    expect(deriveChecklistColumns({}).pilotId).toBeNull();
  });

  it('übernimmt die gewählten Drohnen ohne Duplikate', () => {
    expect(deriveChecklistColumns({ drohnen: ['d1', 'd2', 'd1'] }).droneIds).toEqual(['d1', 'd2']);
    expect(deriveChecklistColumns({}).droneIds).toEqual([]);
  });

  it('leitet Datum und Uhrzeit aus Datum und Zeit ab, sonst bleibt es offen', () => {
    expect(deriveChecklistColumns({ datum: '2026-06-15', zeit: '10:00' }).flightAt?.toISOString()).toBe('2026-06-15T08:00:00.000Z');
    expect(deriveChecklistColumns({ datum: '2026-06-15' }).flightAt).toBeUndefined();
    expect(deriveChecklistColumns({}).flightAt).toBeUndefined();
  });
});

describe('viennaDateParts', () => {
  it('liefert Datum und Uhrzeit in Wiener Ortszeit (Sommerzeit)', () => {
    expect(viennaDateParts(new Date('2026-06-15T08:05:00Z'))).toEqual({ datum: '2026-06-15', zeit: '10:05' });
  });

  it('liefert Datum und Uhrzeit in Wiener Ortszeit (Winterzeit) und rollt über Mitternacht', () => {
    expect(viennaDateParts(new Date('2026-12-15T23:30:00Z'))).toEqual({ datum: '2026-12-16', zeit: '00:30' });
  });

  it('ist die Umkehrung von viennaLocalToDate', () => {
    const date = viennaLocalToDate('2026-09-01', '17:45')!;
    expect(viennaDateParts(date)).toEqual({ datum: '2026-09-01', zeit: '17:45' });
  });
});
