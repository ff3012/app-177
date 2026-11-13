import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import { OPERATION_CHECK_KEYS, PREFLIGHT_CHECK_KEYS, type ChecklistData } from './data';
import { viennaDateParts } from './columns';
import { createChecklistDraft, deleteChecklist, discardChecklist, saveChecklistDraft, submitChecklist } from './service';

const RUN = `ck-test-${Date.now()}`;
const allChecked = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, true]));

let group: { id: string; organizationId: string };
let otherGroup: { id: string; organizationId: string };
let homeOrganizationId: string;
let drone: { id: string };
let inactiveDrone: { id: string };
let foreignDrone: { id: string };

const users: Record<'filler' | 'bos1' | 'plain' | 'admin' | 'foreign' | 'outsider', SessionUser> = {} as never;
const userIds: string[] = [];

function sessionUser(id: string, overrides: Partial<SessionUser>): SessionUser {
  return {
    id,
    email: `${id}@example.local`,
    name: id,
    homeOrganizationId,
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: group.organizationId,
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

async function makeUser(
  key: keyof typeof users,
  membership: { groupId: string; role: 'PILOT' | 'ADMIN'; bos1?: boolean } | null,
) {
  const created = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      homeOrganizationId,
      isActive: true,
      ...(membership
        ? {
            droneMembership: {
              create: {
                droneGroupId: membership.groupId,
                role: membership.role,
                a1a3LizenzAm: membership.bos1 ? new Date('2025-01-01') : null,
                a2LizenzAm: membership.bos1 ? new Date('2025-02-01') : null,
                stuetzpunktausbildungAm: membership.bos1 ? new Date('2025-03-01') : null,
                bos1AusbildungAm: membership.bos1 ? new Date('2025-04-01') : null,
              },
            },
          }
        : {}),
    },
  });
  userIds.push(created.id);
  users[key] = sessionUser(
    created.id,
    membership
      ? { isDrohnengruppeMember: true, droneGroupId: membership.groupId, droneGroupRole: membership.role }
      : {},
  );
}

beforeAll(async () => {
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true } });
  otherGroup = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Kirchberg' }, select: { id: true, organizationId: true } });
  homeOrganizationId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;

  await makeUser('filler', { groupId: group.id, role: 'PILOT' });
  await makeUser('bos1', { groupId: group.id, role: 'PILOT', bos1: true });
  await makeUser('plain', { groupId: group.id, role: 'PILOT' });
  await makeUser('admin', { groupId: group.id, role: 'ADMIN' });
  await makeUser('foreign', { groupId: otherGroup.id, role: 'PILOT' });
  await makeUser('outsider', null);

  drone = await prisma.drone.create({ data: { name: `${RUN}-d1`, droneGroupId: group.id } });
  inactiveDrone = await prisma.drone.create({ data: { name: `${RUN}-d2`, droneGroupId: group.id, isActive: false } });
  foreignDrone = await prisma.drone.create({ data: { name: `${RUN}-d3`, droneGroupId: otherGroup.id } });
});

afterAll(async () => {
  // Flüge, die Tests an Checklisten gehängt haben, zuerst (Fremdschlüssel).
  await prisma.droneFlight.deleteMany({ where: { location: { startsWith: RUN } } });
  await prisma.droneChecklist.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.drone.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

/** Legt einen Entwurf an (als `by`) und gibt die id zurück. */
async function newDraft(by: SessionUser = users.filler): Promise<string> {
  const result = await createChecklistDraft(by, group.id);
  if (!result.ok) throw new Error(`Entwurf konnte nicht angelegt werden: ${result.error}`);
  return result.id;
}

function completeData(): ChecklistData {
  return {
    datum: '2026-06-15',
    zeit: '10:00',
    art: 'Training',
    gebiet: 'Steinbruch',
    drohnen: [drone.id],
    grundlage: 'open',
    openKat: 'A1',
    hoehe: 60,
    pilot: users.filler.id,
    checks: { ...allChecked(PREFLIGHT_CHECK_KEYS), ...allChecked(OPERATION_CHECK_KEYS) },
    bestaetigt: true,
  };
}

describe('createChecklistDraft', () => {
  it('legt für ein Mitglied einen Entwurf mit Wiener Datum/Uhrzeit und dem Mitglied als Pilot an', async () => {
    const id = await newDraft();
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DRAFT');
    expect(row.createdById).toBe(users.filler.id);
    expect(row.droneGroupId).toBe(group.id);
    expect(row.step).toBe(0);
    expect(row.pilotId).toBe(users.filler.id);
    const data = row.data as ChecklistData;
    expect(data.datum).toBe(viennaDateParts(row.flightAt).datum);
    expect(data.zeit).toBe(viennaDateParts(row.flightAt).zeit);
    expect(data.sicht).toBe('VLOS');
    expect(data.pilot).toBe(users.filler.id);
  });

  it('legt für einen Admin ohne Mitgliedschaft einen Entwurf ohne Piloten an', async () => {
    const bezirksAdmin = { ...users.outsider, isBezirksAdmin: true };
    const id = await newDraft(bezirksAdmin);
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect(row.pilotId).toBeNull();
  });

  it('verweigert Benutzern ohne Bezug zur Gruppe', async () => {
    expect(await createChecklistDraft(users.outsider, group.id)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('behandelt eine Gruppe ohne Funktionsschalter wie nicht vorhanden', async () => {
    expect(await createChecklistDraft(users.foreign, otherGroup.id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('behandelt eine unbekannte Gruppe wie nicht vorhanden', async () => {
    expect(await createChecklistDraft(users.filler, 'gibt-es-nicht')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('saveChecklistDraft', () => {
  it('speichert Formularstand, Schritt und die abgeleiteten Spalten samt Drohnen-Verknüpfung', async () => {
    const id = await newDraft();
    const result = await saveChecklistDraft(users.filler, { id, step: 3, data: completeData() });
    expect(result.ok).toBe(true);
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id }, include: { drones: true } });
    expect(row.step).toBe(3);
    expect(row.purpose).toBe('TRAINING');
    expect(row.area).toBe('Steinbruch');
    expect(row.pilotId).toBe(users.filler.id);
    expect(row.flightAt.toISOString()).toBe('2026-06-15T08:00:00.000Z');
    expect(row.drones.map((d) => d.droneId)).toEqual([drone.id]);
    expect((row.data as ChecklistData).gebiet).toBe('Steinbruch');
  });

  it('ersetzt beim erneuten Speichern die Drohnen-Verknüpfung', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 0, data: completeData() });
    await saveChecklistDraft(users.filler, { id, step: 0, data: { ...completeData(), drohnen: [] } });
    expect(await prisma.droneChecklistDrone.count({ where: { checklistId: id } })).toBe(0);
  });

  it('lehnt eine Drohne einer fremden Gruppe ab und ändert nichts', async () => {
    const id = await newDraft();
    const result = await saveChecklistDraft(users.filler, { id, step: 2, data: { ...completeData(), drohnen: [foreignDrone.id] } });
    expect(result).toMatchObject({ ok: false, code: 'INVALID' });
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect(row.step).toBe(0);
    expect(await prisma.droneChecklistDrone.count({ where: { checklistId: id } })).toBe(0);
  });

  it('lehnt eine deaktivierte Drohne ab', async () => {
    const id = await newDraft();
    const result = await saveChecklistDraft(users.filler, { id, step: 0, data: { drohnen: [inactiveDrone.id] } });
    expect(result).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('lehnt einen Piloten ab, der nicht Mitglied der Gruppe ist', async () => {
    const id = await newDraft();
    const result = await saveChecklistDraft(users.filler, { id, step: 0, data: { pilot: users.foreign.id } });
    expect(result).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('prüft auch die Piloten eines Pilotenwechsels (nur Mitglieder der Gruppe, Wechsel bleibt gespeichert)', async () => {
    const id = await newDraft();
    const bad = await saveChecklistDraft(users.filler, { id, step: 6, data: { pilotWechsel: [{ pilot: users.foreign.id }] } });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID' });
    const ok = await saveChecklistDraft(users.filler, { id, step: 6, data: { pilotWechsel: [{ pilot: users.bos1.id, zeit: '11:30', kommentar15: 'x' }] } });
    expect(ok).toMatchObject({ ok: true });
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect((row.data as ChecklistData).pilotWechsel?.[0]).toMatchObject({ pilot: users.bos1.id, zeit: '11:30', kommentar15: 'x' });
  });

  it('lehnt ungültige Formulardaten ab', async () => {
    const id = await newDraft();
    const bad = { hoehe: '60' } as unknown as ChecklistData;
    expect(await saveChecklistDraft(users.filler, { id, step: 0, data: bad })).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('lehnt einen Schritt außerhalb von 0-8 ab', async () => {
    const id = await newDraft();
    expect(await saveChecklistDraft(users.filler, { id, step: 9, data: {} })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await saveChecklistDraft(users.filler, { id, step: -1, data: {} })).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('erlaubt dem BOS1-Piloten, einen fremden Entwurf zu bearbeiten', async () => {
    const id = await newDraft();
    expect((await saveChecklistDraft(users.bos1, { id, step: 1, data: { art: 'Einsatz' } })).ok).toBe(true);
  });

  it('verweigert einem Mitglied ohne BOS1, einen fremden Entwurf zu bearbeiten, aber sehen darf es ihn', async () => {
    const id = await newDraft();
    expect(await saveChecklistDraft(users.plain, { id, step: 1, data: { art: 'Einsatz' } })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('verbirgt den Entwurf vor Mitgliedern fremder Gruppen und Unbeteiligten', async () => {
    const id = await newDraft();
    for (const u of [users.foreign, users.outsider]) {
      expect(await saveChecklistDraft(u, { id, step: 1, data: {} })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    }
  });

  it('lehnt das Bearbeiten einer abgeschlossenen Checkliste ab', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 8, data: completeData() });
    expect((await submitChecklist(users.filler, id)).ok).toBe(true);
    expect(await saveChecklistDraft(users.filler, { id, step: 0, data: {} })).toMatchObject({ ok: false });
  });
});

describe('discardChecklist', () => {
  it('verwirft einen Entwurf, ohne die Zeile zu löschen', async () => {
    const id = await newDraft();
    expect((await discardChecklist(users.filler, id)).ok).toBe(true);
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DISCARDED');
    expect(row.discardedAt).not.toBeNull();
  });

  it('erlaubt Admins, fremde Entwürfe zu verwerfen', async () => {
    const id = await newDraft();
    expect((await discardChecklist(users.admin, id)).ok).toBe(true);
  });

  it('verweigert dem BOS1-Piloten, einen fremden Entwurf zu verwerfen', async () => {
    const id = await newDraft();
    expect(await discardChecklist(users.bos1, id)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await prisma.droneChecklist.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('kann eine bereits verworfene Checkliste nicht erneut verwerfen', async () => {
    const id = await newDraft();
    await discardChecklist(users.filler, id);
    expect(await discardChecklist(users.filler, id)).toMatchObject({ ok: false });
  });
});

describe('deleteChecklist', () => {
  const exists = async (id: string) => (await prisma.droneChecklist.count({ where: { id } })) === 1;

  it('löscht einen eigenen Entwurf endgültig (Zeile und Drohnen-Zuordnung sind weg)', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 2, data: { drohnen: [drone.id] } });
    expect(await prisma.droneChecklistDrone.count({ where: { checklistId: id } })).toBe(1);
    expect((await deleteChecklist(users.filler, id)).ok).toBe(true);
    expect(await exists(id)).toBe(false);
    expect(await prisma.droneChecklistDrone.count({ where: { checklistId: id } })).toBe(0);
  });

  it('erlaubt dem Admin der Gruppe, einen fremden Entwurf zu löschen', async () => {
    const id = await newDraft();
    expect((await deleteChecklist(users.admin, id)).ok).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it('verweigert dem BOS1-Piloten und anderen Mitgliedern, einen fremden Entwurf zu löschen', async () => {
    const id = await newDraft();
    expect(await deleteChecklist(users.bos1, id)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await deleteChecklist(users.plain, id)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await exists(id)).toBe(true);
  });

  it('behandelt Fremde (andere Gruppe, ohne Mitgliedschaft) wie "nicht gefunden" und löscht nichts', async () => {
    const id = await newDraft();
    expect(await deleteChecklist(users.foreign, id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await deleteChecklist(users.outsider, id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await exists(id)).toBe(true);
  });

  it('antwortet für eine unbekannte id mit "nicht gefunden"', async () => {
    expect(await deleteChecklist(users.admin, 'gibt-es-nicht')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('löscht keine abgeschlossene und keine verworfene Checkliste, auch nicht als Admin', async () => {
    const submitted = await newDraft();
    await saveChecklistDraft(users.filler, { id: submitted, step: 8, data: completeData() });
    expect((await submitChecklist(users.filler, submitted)).ok).toBe(true);
    const discarded = await newDraft();
    await discardChecklist(users.filler, discarded);
    for (const id of [submitted, discarded]) {
      expect(await deleteChecklist(users.filler, id)).toMatchObject({ ok: false, code: 'INVALID' });
      expect(await deleteChecklist(users.admin, id)).toMatchObject({ ok: false, code: 'INVALID' });
      expect(await exists(id)).toBe(true);
    }
  });

  it('sperrt das Löschen, solange ein Flug mit dem Entwurf verknüpft ist, und gibt es danach frei', async () => {
    const id = await newDraft();
    const flight = await prisma.droneFlight.create({
      data: {
        startsAt: new Date('2026-06-15T08:00:00Z'),
        pilotUserId: users.filler.id,
        location: `${RUN}-ort`,
        droneId: drone.id,
        purpose: 'EINSATZ',
        registeredById: users.filler.id,
        checklistId: id,
      },
    });
    const blocked = await deleteChecklist(users.filler, id);
    expect(blocked).toMatchObject({ ok: false, code: 'INVALID' });
    expect(blocked.ok === false && blocked.error).toContain('Flug');
    expect(await exists(id)).toBe(true);
    await prisma.droneFlight.delete({ where: { id: flight.id } });
    expect((await deleteChecklist(users.filler, id)).ok).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it('kann denselben Entwurf nicht zweimal löschen', async () => {
    const id = await newDraft();
    expect((await deleteChecklist(users.filler, id)).ok).toBe(true);
    expect(await deleteChecklist(users.filler, id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('submitChecklist', () => {
  it('meldet fehlende Pflichtpunkte und lässt den Entwurf unverändert', async () => {
    const id = await newDraft();
    const result = await submitChecklist(users.filler, id);
    expect(result).toMatchObject({ ok: false, code: 'INVALID' });
    expect(result.ok === false && result.missing?.map((m) => m.text)).toContain('Art des Fluges');
    expect((await prisma.droneChecklist.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('schließt ein vollständiges Formular ab und setzt Zeitstempel und Ausfüller', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 8, data: completeData() });
    expect((await submitChecklist(users.filler, id)).ok).toBe(true);
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUBMITTED');
    expect(row.submittedAt).not.toBeNull();
    expect(row.confirmedAt).not.toBeNull();
    expect(row.submittedById).toBe(users.filler.id);
  });

  it('legt beim Abschließen keinen Flug an', async () => {
    const before = await prisma.droneFlight.count();
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 8, data: completeData() });
    await submitChecklist(users.filler, id);
    expect(await prisma.droneFlight.count()).toBe(before);
  });

  it('lässt einen BOS1-Piloten einen fremden Entwurf abschließen; der Ersteller bleibt Ersteller', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.bos1, { id, step: 8, data: completeData() });
    expect((await submitChecklist(users.bos1, id)).ok).toBe(true);
    const row = await prisma.droneChecklist.findUniqueOrThrow({ where: { id } });
    expect(row.createdById).toBe(users.filler.id);
    expect(row.submittedById).toBe(users.bos1.id);
  });

  it('verweigert dem Ersteller ohne BOS1, der nicht der gewählte Pilot ist, das Abschließen', async () => {
    const id = await newDraft(users.plain);
    await saveChecklistDraft(users.plain, { id, step: 8, data: { ...completeData(), pilot: users.filler.id } });
    expect(await submitChecklist(users.plain, id)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await prisma.droneChecklist.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('schließt dieselbe Checkliste kein zweites Mal ab', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 8, data: completeData() });
    expect((await submitChecklist(users.filler, id)).ok).toBe(true);
    expect(await submitChecklist(users.filler, id)).toMatchObject({ ok: false });
  });

  it('verweigert das Abschließen, wenn die gewählte Drohne inzwischen deaktiviert wurde', async () => {
    const id = await newDraft();
    await saveChecklistDraft(users.filler, { id, step: 8, data: completeData() });
    await prisma.drone.update({ where: { id: drone.id }, data: { isActive: false } });
    try {
      expect(await submitChecklist(users.filler, id)).toMatchObject({ ok: false, code: 'INVALID' });
    } finally {
      await prisma.drone.update({ where: { id: drone.id }, data: { isActive: true } });
    }
  });

  it('verbirgt fremde Checklisten vor Unbeteiligten', async () => {
    const id = await newDraft();
    expect(await submitChecklist(users.outsider, id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
