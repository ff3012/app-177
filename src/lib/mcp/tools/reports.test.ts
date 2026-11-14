import { describe, expect, it } from 'vitest';
import { activityLabels, reportScopeWhere, reportSearchWhere } from './reports';
import { sessionUserFixture } from './test-support';

describe('reportScopeWhere', () => {
  it('Bezirksadmin: keine Einschränkung', () => {
    expect(reportScopeWhere(sessionUserFixture({ id: 'u1', isBezirksAdmin: true }))).toEqual({});
  });

  it('alle anderen: eigene Berichte (Ersteller oder Ausfüller) oder Berichte der verwalteten Feuerwehren', () => {
    expect(reportScopeWhere(sessionUserFixture({ id: 'u1', feuerwehrAdminOrgIds: ['a', 'b'] }))).toEqual({
      OR: [{ createdById: 'u1' }, { filledById: 'u1' }, { fireDepartmentId: { in: ['a', 'b'] } }],
    });
  });

  it('ein Mitglied ohne Verwaltungsrecht sieht nur eigene Berichte', () => {
    expect(reportScopeWhere(sessionUserFixture({ id: 'u1' }))).toEqual({
      OR: [{ createdById: 'u1' }, { filledById: 'u1' }, { fireDepartmentId: { in: [] } }],
    });
  });
});

describe('reportSearchWhere', () => {
  it('sucht ohne Beachtung der Groß-/Kleinschreibung in Bemerkung, Sonstiger Tätigkeit sowie Übungsziel und -ort', () => {
    const where = reportSearchWhere('  Brand ');
    const fields = (where.OR as Record<string, unknown>[]).map((clause) => Object.keys(clause)[0]).sort();
    expect(fields).toEqual(['activityOther', 'remark', 'uebungsortOrt', 'uebungsortStrasse', 'uebungsziel']);
    for (const clause of where.OR as Record<string, { contains: string; mode: string }>[]) {
      const [condition] = Object.values(clause);
      expect(condition).toEqual({ contains: 'Brand', mode: 'insensitive' });
    }
  });

  it('liefert für leeren Text keine Einschränkung', () => {
    expect(reportSearchWhere('   ')).toEqual({});
  });
});

describe('activityLabels', () => {
  it('löst Tätigkeitsarten über die Codeliste des Berichtstyps auf und hängt Sonstiges an', () => {
    expect(activityLabels('ACTIVITY', ['ATEMSCHUTZ'], 'Hydrantenpflege')).toEqual(['Atemschutz', 'Sonstige: Hydrantenpflege']);
  });

  it('nutzt für Übungsberichte die Übungsarten', () => {
    expect(activityLabels('EXERCISE', ['UE_FUNKUEBUNG'], null)).toEqual(['Funkübung']);
  });

  it('gibt unbekannte Codes unverändert zurück statt sie zu verlieren', () => {
    expect(activityLabels('ACTIVITY', ['GIBT_ES_NICHT'], null)).toEqual(['GIBT_ES_NICHT']);
  });
});
