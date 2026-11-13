import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/types/next-auth';
import { canGrantMcpAccess } from './permissions';

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u1',
    email: 'u1@example.local',
    name: 'U1',
    homeOrganizationId: 'org-a',
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: 'abschnitt-1',
    feuerwehrAdminOrgIds: [],
    abschnittAdminOrgIds: [],
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    isAbschnittskommandoMitglied: false,
    isDrohnengruppeMember: false,
    droneGroupId: null,
    droneGroupRole: null,
    ...overrides,
  };
}

const target = (mcpAccess: 'NONE' | 'READ' | 'WRITE', homeOrganizationId = 'org-a') => ({ homeOrganizationId, mcpAccess });

describe('canGrantMcpAccess', () => {
  it('erlaubt jede Änderung, die nichts ändert (gleiche Stufe)', () => {
    expect(canGrantMcpAccess(user(), 'NONE', target('READ', 'fremd'), 'READ')).toBe(true);
  });

  it('Bezirksadmin darf jedem jede Stufe geben, auch ohne eigene Stufe', () => {
    const admin = user({ isBezirksAdmin: true });
    expect(canGrantMcpAccess(admin, 'NONE', target('NONE', 'irgendwo'), 'WRITE')).toBe(true);
    expect(canGrantMcpAccess(admin, 'NONE', target('WRITE', 'irgendwo'), 'NONE')).toBe(true);
  });

  it('Feuerwehr-Admin mit WRITE darf im eigenen Bereich READ und WRITE vergeben und entziehen', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE'), 'READ')).toBe(true);
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE'), 'WRITE')).toBe(true);
    expect(canGrantMcpAccess(admin, 'WRITE', target('WRITE'), 'NONE')).toBe(true);
  });

  it('Admin mit READ darf READ vergeben, aber weder WRITE vergeben noch einem WRITE-Benutzer die Stufe senken', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'READ', target('NONE'), 'READ')).toBe(true);
    expect(canGrantMcpAccess(admin, 'READ', target('NONE'), 'WRITE')).toBe(false);
    expect(canGrantMcpAccess(admin, 'READ', target('WRITE'), 'READ')).toBe(false);
    expect(canGrantMcpAccess(admin, 'READ', target('WRITE'), 'NONE')).toBe(false);
  });

  it('Admin ohne eigene MCP-Stufe darf nichts vergeben', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'NONE', target('NONE'), 'READ')).toBe(false);
  });

  it('Admin darf nur im eigenen Verwaltungsbereich vergeben', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE', 'org-b'), 'READ')).toBe(false);
  });

  it('Abschnittsadmin erbt über feuerwehrAdminOrgIds die Feuerwehren seines Abschnitts', () => {
    const admin = user({ abschnittAdminOrgIds: ['abschnitt-1'], feuerwehrAdminOrgIds: ['abschnitt-1', 'org-a', 'org-c'] });
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE', 'org-c'), 'READ')).toBe(true);
  });

  it('ein Mitglied ohne Admin-Recht darf nichts vergeben, auch nicht mit WRITE', () => {
    expect(canGrantMcpAccess(user(), 'WRITE', target('NONE'), 'READ')).toBe(false);
  });
});
