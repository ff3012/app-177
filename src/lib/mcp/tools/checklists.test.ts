import { describe, expect, it } from 'vitest';
import { checkPoints, checklistScopeWhere, checklistSearchWhere, viennaIsoOrNull } from './checklists';
import { sessionUserFixture } from './test-support';

describe('checklistScopeWhere', () => {
  it('nur abgeschlossene Checklisten von Gruppen mit Funktionsschalter, eigene oder aus verwalteten Gruppen', () => {
    expect(checklistScopeWhere(sessionUserFixture({ id: 'u1' }), ['g1'])).toEqual({
      status: 'SUBMITTED',
      droneGroup: { featureChecklist: true },
      OR: [{ createdById: 'u1' }, { submittedById: 'u1' }, { droneGroupId: { in: ['g1'] } }],
    });
  });

  it('ohne verwaltete Gruppen bleiben nur die eigenen (Ersteller/Abschließer)', () => {
    expect(checklistScopeWhere(sessionUserFixture({ id: 'u1' }), [])).toEqual({
      status: 'SUBMITTED',
      droneGroup: { featureChecklist: true },
      OR: [{ createdById: 'u1' }, { submittedById: 'u1' }, { droneGroupId: { in: [] } }],
    });
  });
});

describe('checklistSearchWhere', () => {
  it('sucht im Fluggebiet/Gemeindegebiet (Spalte area), ohne Beachtung der Schreibweise', () => {
    expect(checklistSearchWhere(' Wald ')).toEqual({ area: { contains: 'Wald', mode: 'insensitive' } });
    expect(checklistSearchWhere('  ')).toEqual({});
  });
});

describe('checkPoints', () => {
  it('liefert je Kontrollpunkt Nummer, Klartext und ob er erledigt ist (nur true zählt)', () => {
    const points = checkPoints(
      [
        { key: 'a', nr: '15.1', label: 'Erster Punkt' },
        { key: 'b', nr: '15.2', label: 'Zweiter Punkt' },
        { key: 'c', nr: '15.3', label: 'Dritter Punkt' },
      ],
      { a: true, b: false },
    );
    expect(points).toEqual([
      { nummer: '15.1', text: 'Erster Punkt', erledigt: true },
      { nummer: '15.2', text: 'Zweiter Punkt', erledigt: false },
      { nummer: '15.3', text: 'Dritter Punkt', erledigt: false },
    ]);
  });
});

describe('viennaIsoOrNull', () => {
  it('formatiert gültige ISO-Zeiten als Wiener Ortszeit mit Offset', () => {
    expect(viennaIsoOrNull('2030-06-15T09:30:00Z')).toBe('2030-06-15T11:30:00+02:00');
  });

  it('liefert für fehlende oder ungültige Werte null statt eines RangeError', () => {
    expect(viennaIsoOrNull(null)).toBeNull();
    expect(viennaIsoOrNull(undefined)).toBeNull();
    expect(viennaIsoOrNull('')).toBeNull();
    expect(viennaIsoOrNull('kein-datum')).toBeNull();
  });
});
