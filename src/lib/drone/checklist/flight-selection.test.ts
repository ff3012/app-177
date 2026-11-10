import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/types/next-auth';
import { FLIGHT_CHECKLIST_LIMIT, selectChecklistsForFlight, type SelectableChecklist } from './flight-selection';

const GROUP = { id: 'group-1', organizationId: 'abschnitt-1' };

function user(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'me',
    email: 'me@example.test',
    name: 'Me',
    homeOrganizationId: 'ff-1',
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: 'abschnitt-1',
    feuerwehrAdminOrgIds: [],
    abschnittAdminOrgIds: [],
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    isAbschnittskommandoMitglied: false,
    isDrohnengruppeMember: true,
    droneGroupId: GROUP.id,
    droneGroupRole: 'PILOT',
    ...overrides,
  };
}

let counter = 0;
function checklist(overrides: Partial<SelectableChecklist> = {}): SelectableChecklist {
  counter += 1;
  return {
    id: `c${counter}`,
    status: 'DRAFT',
    createdById: 'someone-else',
    updatedAt: new Date(Date.UTC(2026, 5, counter)),
    ...overrides,
  };
}

describe('selectChecklistsForFlight', () => {
  it('zeigt höchstens 4 Checklisten, neueste zuerst', () => {
    expect(FLIGHT_CHECKLIST_LIMIT).toBe(4);
    const list = Array.from({ length: 6 }, () => checklist());
    const result = selectChecklistsForFlight(list, user({}), GROUP);
    expect(result.map((c) => c.id)).toEqual(list.slice(-4).reverse().map((c) => c.id));
  });

  it('nimmt Entwürfe und abgeschlossene Checklisten, aber keine verworfenen', () => {
    const list = [
      checklist({ status: 'DISCARDED', createdById: 'me' }),
      checklist({ status: 'SUBMITTED', createdById: 'me' }),
      checklist({ status: 'DRAFT' }),
    ];
    const result = selectChecklistsForFlight(list, user({}), GROUP);
    expect(result.map((c) => c.status).sort()).toEqual(['DRAFT', 'SUBMITTED']);
  });

  it('blendet fremde abgeschlossene Checklisten für gewöhnliche Mitglieder aus', () => {
    const own = checklist({ status: 'SUBMITTED', createdById: 'me' });
    const foreign = checklist({ status: 'SUBMITTED', createdById: 'other' });
    const result = selectChecklistsForFlight([own, foreign], user({}), GROUP);
    expect(result).toEqual([own]);
  });

  it('zeigt eine von mir abgeschlossene Checkliste, auch wenn ein anderer sie angelegt hat', () => {
    const completedByMe = checklist({ status: 'SUBMITTED', createdById: 'other', submittedById: 'me' });
    expect(selectChecklistsForFlight([completedByMe], user({}), GROUP)).toEqual([completedByMe]);
  });

  it('zeigt Admins auch fremde abgeschlossene Checklisten', () => {
    const foreign = checklist({ status: 'SUBMITTED', createdById: 'other' });
    const result = selectChecklistsForFlight([foreign], user({ droneGroupRole: 'ADMIN' }), GROUP);
    expect(result).toEqual([foreign]);
  });

  it('füllt die 4 Plätze nur mit sichtbaren Checklisten auf', () => {
    const hidden = Array.from({ length: 5 }, () => checklist({ status: 'SUBMITTED', createdById: 'other' }));
    const visible = checklist({ status: 'DRAFT' });
    const result = selectChecklistsForFlight([visible, ...hidden], user({}), GROUP);
    expect(result).toEqual([visible]);
  });

  it('sortiert nach letzter Änderung, nicht nach der Reihenfolge der Eingabe', () => {
    const older = checklist({ updatedAt: new Date('2026-01-01') });
    const newer = checklist({ updatedAt: new Date('2026-03-01') });
    expect(selectChecklistsForFlight([older, newer], user({}), GROUP)).toEqual([newer, older]);
  });
});
