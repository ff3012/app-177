import { describe, expect, it } from 'vitest';
import { pickReportType, resolveReportTypeSettings } from './report-type-settings';

describe('resolveReportTypeSettings', () => {
  it('liefert für jede freigeschaltete Art einen Eintrag, ohne Zeile eingeschaltet und ohne Empfänger', () => {
    expect(resolveReportTypeSettings([])).toEqual({
      ACTIVITY: { enabled: true, recipients: [] },
      EXERCISE: { enabled: true, recipients: [] },
    });
  });

  it('übernimmt gespeicherte Zeilen je Art', () => {
    const result = resolveReportTypeSettings([
      { type: 'EXERCISE', enabled: false, recipients: ['a@x.at'] },
      { type: 'ACTIVITY', enabled: true, recipients: ['b@x.at', 'c@x.at'] },
    ]);
    expect(result.EXERCISE).toEqual({ enabled: false, recipients: ['a@x.at'] });
    expect(result.ACTIVITY).toEqual({ enabled: true, recipients: ['b@x.at', 'c@x.at'] });
  });

  it('ignoriert Zeilen nicht freigeschalteter Arten (Einsatzbericht)', () => {
    const result = resolveReportTypeSettings([{ type: 'INCIDENT', enabled: true, recipients: ['x@x.at'] }]);
    expect(Object.keys(result).sort()).toEqual(['ACTIVITY', 'EXERCISE']);
  });
});

describe('pickReportType', () => {
  it('nimmt den gewünschten Typ, wenn er eingeschaltet ist', () => {
    expect(pickReportType('EXERCISE', ['ACTIVITY', 'EXERCISE'])).toBe('EXERCISE');
  });

  it('fällt bei einem abgeschalteten oder unbekannten Typ auf den ersten eingeschalteten zurück', () => {
    expect(pickReportType('EXERCISE', ['ACTIVITY'])).toBe('ACTIVITY');
    expect(pickReportType('FOO', ['EXERCISE', 'ACTIVITY'])).toBe('EXERCISE');
    expect(pickReportType(undefined, ['ACTIVITY'])).toBe('ACTIVITY');
    expect(pickReportType(null, ['ACTIVITY'])).toBe('ACTIVITY');
  });

  it('liefert null, wenn keine Art eingeschaltet ist', () => {
    expect(pickReportType('ACTIVITY', [])).toBeNull();
  });
});
