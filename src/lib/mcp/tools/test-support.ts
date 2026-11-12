import type { SessionUser } from '@/types/next-auth';
import type { McpAccessLevel } from '../access';
import type { McpPrincipal } from '../auth';

/** Nur für Tests: vollständiges SessionUser ohne Rechte, einzelne Felder überschreibbar. */
export function sessionUserFixture(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u-test',
    email: 'u-test@example.local',
    name: 'Test User',
    homeOrganizationId: 'org-test',
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: 'abschnitt-test',
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

export function principalFixture(user: SessionUser, access: McpAccessLevel = 'READ'): McpPrincipal {
  return { user, access, clientId: 'mcp_test', clientName: 'Test', tokenId: `tok-${Math.random()}` };
}
