import { describe, expect, it } from 'vitest';
import { sessionUserFixture } from './test-support';
import { searchWhere, statusWhere, userScopeWhere } from './users';

describe('userScopeWhere', () => {
  it('Bezirksadmin: keine Einschränkung', () => {
    expect(userScopeWhere(sessionUserFixture({ isBezirksAdmin: true }))).toEqual({});
  });

  it('andere Admins: nur die Heimatfeuerwehren im eigenen Verwaltungsbereich', () => {
    expect(userScopeWhere(sessionUserFixture({ feuerwehrAdminOrgIds: ['a', 'b'] }))).toEqual({ homeOrganizationId: { in: ['a', 'b'] } });
  });
});

describe('statusWhere', () => {
  it('bildet die drei Zustände wie getUserStatus ab', () => {
    expect(statusWhere('aktiv')).toEqual({ isActive: true });
    expect(statusWhere('inaktiv')).toEqual({ isActive: false, passwordChangedAt: null });
    expect(statusWhere('deaktiviert')).toEqual({ isActive: false, passwordChangedAt: { not: null } });
  });
});

describe('searchWhere', () => {
  it('verknüpft die Suchwörter per UND über Vorname, Nachname und E-Mail', () => {
    expect(searchWhere(' Max  Muster ')).toEqual({
      AND: [
        { OR: [{ firstName: { contains: 'Max', mode: 'insensitive' } }, { lastName: { contains: 'Max', mode: 'insensitive' } }, { email: { contains: 'Max', mode: 'insensitive' } }] },
        { OR: [{ firstName: { contains: 'Muster', mode: 'insensitive' } }, { lastName: { contains: 'Muster', mode: 'insensitive' } }, { email: { contains: 'Muster', mode: 'insensitive' } }] },
      ],
    });
  });

  it('liefert für leeren Text keine Einschränkung', () => {
    expect(searchWhere('   ')).toEqual({});
  });
});
