import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/types/next-auth';
import {
  canConfirmChecklist,
  canCreateChecklist,
  canDiscardChecklist,
  canDownloadChecklistPdf,
  canEditChecklist,
  canManageChecklists,
  canViewChecklist,
} from './permissions';

const GROUP = { id: 'group-1', organizationId: 'abschnitt-1' };

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-x',
    email: 'x@example.test',
    name: 'X',
    homeOrganizationId: 'ff-1',
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

const member = (id: string, role: 'PILOT' | 'VIEWER' | 'ADMIN' = 'PILOT') =>
  user({ id, isDrohnengruppeMember: true, droneGroupId: GROUP.id, droneGroupRole: role });

const filler = member('filler');
const otherMember = member('other');
const viewer = member('viewer', 'VIEWER');
const groupAdmin = member('admin', 'ADMIN');
const foreignMember = user({ id: 'foreign', isDrohnengruppeMember: true, droneGroupId: 'group-2', droneGroupRole: 'PILOT' });
const foreignAdmin = user({ id: 'foreign-admin', isDrohnengruppeMember: true, droneGroupId: 'group-2', droneGroupRole: 'ADMIN' });
const bezirksDrohnenAdmin = user({ id: 'bda', isBezirksDrohnenAdmin: true });
const bezirksAdmin = user({ id: 'ba', isBezirksAdmin: true });
const abschnittsAdmin = user({ id: 'aa', abschnittAdminOrgIds: [GROUP.organizationId] });
const outsider = user({ id: 'outsider' });

const draft = { createdById: filler.id, status: 'DRAFT' as const };
const submitted = { createdById: filler.id, status: 'SUBMITTED' as const };
const discarded = { createdById: filler.id, status: 'DISCARDED' as const };

describe('canViewChecklist', () => {
  it('zeigt Entwürfe allen Mitgliedern der Drohnengruppe (auch Betrachtern)', () => {
    for (const u of [filler, otherMember, viewer, groupAdmin]) {
      expect(canViewChecklist(u, draft, GROUP), u.id).toBe(true);
    }
  });

  it('zeigt Entwürfe nicht Mitgliedern fremder Gruppen oder Unbeteiligten', () => {
    for (const u of [foreignMember, foreignAdmin, outsider]) {
      expect(canViewChecklist(u, draft, GROUP), u.id).toBe(false);
    }
  });

  it('zeigt abgeschlossene Checklisten nur dem Ausfüller und den Admins der Gruppe', () => {
    for (const u of [filler, groupAdmin, bezirksDrohnenAdmin, bezirksAdmin, abschnittsAdmin]) {
      expect(canViewChecklist(u, submitted, GROUP), u.id).toBe(true);
    }
  });

  it('verbirgt abgeschlossene Checklisten vor anderen Mitgliedern der eigenen Gruppe', () => {
    for (const u of [otherMember, viewer, foreignMember, foreignAdmin, outsider]) {
      expect(canViewChecklist(u, submitted, GROUP), u.id).toBe(false);
    }
  });

  it('zeigt verworfene Checklisten nur dem Ausfüller und den Admins', () => {
    expect(canViewChecklist(filler, discarded, GROUP)).toBe(true);
    expect(canViewChecklist(groupAdmin, discarded, GROUP)).toBe(true);
    expect(canViewChecklist(otherMember, discarded, GROUP)).toBe(false);
  });

  it('zeigt dem Ausfüller seine Checkliste auch nach einem Gruppenwechsel', () => {
    const left = user({ id: filler.id, isDrohnengruppeMember: false, droneGroupId: null });
    expect(canViewChecklist(left, submitted, GROUP)).toBe(true);
  });

  it('gibt dem Admin einer fremden Gruppe keinen Zugriff', () => {
    expect(canViewChecklist(foreignAdmin, submitted, GROUP)).toBe(false);
  });
});

describe('canEditChecklist (bearbeiten und verwerfen)', () => {
  it('erlaubt dem Ausfüller und Admins, einen Entwurf zu bearbeiten', () => {
    for (const u of [filler, groupAdmin, bezirksDrohnenAdmin, bezirksAdmin]) {
      expect(canEditChecklist(u, draft, GROUP), u.id).toBe(true);
    }
  });

  it('lässt andere Mitglieder einen fremden Entwurf nur ansehen', () => {
    for (const u of [otherMember, viewer, foreignMember, outsider]) {
      expect(canEditChecklist(u, draft, GROUP), u.id).toBe(false);
    }
  });

  it('macht abgeschlossene und verworfene Checklisten für alle schreibgeschützt', () => {
    for (const u of [filler, groupAdmin, bezirksAdmin]) {
      expect(canEditChecklist(u, submitted, GROUP), u.id).toBe(false);
      expect(canEditChecklist(u, discarded, GROUP), u.id).toBe(false);
    }
  });
});

describe('canDownloadChecklistPdf', () => {
  it('gibt das PDF einer abgeschlossenen Checkliste dem Ausfüller und Admins', () => {
    for (const u of [filler, groupAdmin, bezirksDrohnenAdmin]) {
      expect(canDownloadChecklistPdf(u, submitted, GROUP), u.id).toBe(true);
    }
  });

  it('verweigert das PDF anderen Mitgliedern und Fremden', () => {
    for (const u of [otherMember, viewer, foreignAdmin, outsider]) {
      expect(canDownloadChecklistPdf(u, submitted, GROUP), u.id).toBe(false);
    }
  });

  it('kennt für Entwürfe und verworfene Checklisten kein PDF', () => {
    expect(canDownloadChecklistPdf(filler, draft, GROUP)).toBe(false);
    expect(canDownloadChecklistPdf(groupAdmin, discarded, GROUP)).toBe(false);
  });
});

describe('canCreateChecklist', () => {
  it('erlaubt Mitgliedern der Gruppe und ihren Admins, eine Checkliste anzulegen', () => {
    for (const u of [filler, viewer, groupAdmin, bezirksDrohnenAdmin, bezirksAdmin]) {
      expect(canCreateChecklist(u, GROUP), u.id).toBe(true);
    }
  });

  it('verweigert Mitgliedern fremder Gruppen und Unbeteiligten', () => {
    for (const u of [foreignMember, foreignAdmin, outsider]) {
      expect(canCreateChecklist(u, GROUP), u.id).toBe(false);
    }
  });
});

describe('canManageChecklists (erneut senden, Benachrichtigungsadresse)', () => {
  it('ist Admins der Gruppe vorbehalten', () => {
    for (const u of [groupAdmin, bezirksDrohnenAdmin, bezirksAdmin, abschnittsAdmin]) {
      expect(canManageChecklists(u, GROUP), u.id).toBe(true);
    }
    for (const u of [filler, otherMember, foreignAdmin, outsider]) {
      expect(canManageChecklists(u, GROUP), u.id).toBe(false);
    }
  });
});

// --- BOS1-Pilot füllt fremden Entwurf aus und schließt ihn ab ---------------------------------------

describe('BOS1-Pilot der Gruppe', () => {
  const bos1 = member('bos1');

  it('darf einen fremden Entwurf bearbeiten und abschließen', () => {
    expect(canEditChecklist(bos1, draft, GROUP, true)).toBe(true);
    expect(canEditChecklist(otherMember, draft, GROUP, false)).toBe(false);
  });

  it('gilt nur in der eigenen Drohnengruppe', () => {
    expect(canEditChecklist(foreignMember, draft, GROUP, true)).toBe(false);
    expect(canEditChecklist(outsider, draft, GROUP, true)).toBe(false);
  });

  it('kann abgeschlossene Checklisten weiterhin nicht bearbeiten', () => {
    expect(canEditChecklist(bos1, submitted, GROUP, true)).toBe(false);
  });

  it('darf fremde Entwürfe nicht verwerfen', () => {
    expect(canDiscardChecklist(bos1, draft, GROUP)).toBe(false);
  });

  it('darf die abgeschlossene Checkliste danach selbst sehen und als PDF laden', () => {
    const completedByBos1 = { createdById: filler.id, submittedById: bos1.id, status: 'SUBMITTED' as const };
    expect(canViewChecklist(bos1, completedByBos1, GROUP)).toBe(true);
    expect(canDownloadChecklistPdf(bos1, completedByBos1, GROUP)).toBe(true);
    // Der ursprüngliche Ersteller bleibt "Ausfüller" und sieht sie ebenfalls.
    expect(canViewChecklist(filler, completedByBos1, GROUP)).toBe(true);
    // Andere Mitglieder weiterhin nicht.
    expect(canViewChecklist(otherMember, completedByBos1, GROUP)).toBe(false);
    expect(canDownloadChecklistPdf(otherMember, completedByBos1, GROUP)).toBe(false);
  });
});

describe('canDiscardChecklist', () => {
  it('erlaubt Ersteller und Admins, einen Entwurf zu verwerfen', () => {
    for (const u of [filler, groupAdmin, bezirksDrohnenAdmin, bezirksAdmin]) {
      expect(canDiscardChecklist(u, draft, GROUP), u.id).toBe(true);
    }
  });

  it('verweigert allen anderen und bei Nicht-Entwürfen', () => {
    for (const u of [otherMember, viewer, foreignAdmin, outsider]) {
      expect(canDiscardChecklist(u, draft, GROUP), u.id).toBe(false);
    }
    expect(canDiscardChecklist(filler, submitted, GROUP)).toBe(false);
    expect(canDiscardChecklist(groupAdmin, discarded, GROUP)).toBe(false);
  });
});

describe('canConfirmChecklist (Bestätigung des Piloten beim Abschließen)', () => {
  it('erlaubt dem gewählten Piloten, Admins und BOS1-Piloten der Gruppe', () => {
    expect(canConfirmChecklist(otherMember, GROUP, otherMember.id, false)).toBe(true);
    expect(canConfirmChecklist(groupAdmin, GROUP, otherMember.id, false)).toBe(true);
    expect(canConfirmChecklist(bezirksDrohnenAdmin, GROUP, otherMember.id, false)).toBe(true);
    expect(canConfirmChecklist(member('bos1'), GROUP, otherMember.id, true)).toBe(true);
  });

  it('verweigert anderen Mitgliedern ohne BOS1 und Fremden', () => {
    expect(canConfirmChecklist(filler, GROUP, otherMember.id, false)).toBe(false);
    expect(canConfirmChecklist(viewer, GROUP, otherMember.id, false)).toBe(false);
    expect(canConfirmChecklist(foreignMember, GROUP, otherMember.id, true)).toBe(false);
    expect(canConfirmChecklist(outsider, GROUP, otherMember.id, true)).toBe(false);
  });

  it('verweigert die Bestätigung, wenn kein Pilot gewählt ist und der Benutzer weder Admin noch BOS1 ist', () => {
    expect(canConfirmChecklist(filler, GROUP, null, false)).toBe(false);
  });
});
