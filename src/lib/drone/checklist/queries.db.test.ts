import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import {
  checklistCounts,
  checklistTitle,
  getChecklistView,
  listChecklistsAdmin,
  listChecklistsForFlight,
  listGroupDrafts,
  resolveLinkableChecklist,
} from './queries';

const RUN = `ck-query-${Date.now()}`;

let group: { id: string; organizationId: string; featureChecklist: boolean };
let otherGroup: { id: string; organizationId: string };
let homeOrganizationId: string;
let drone: { id: string };
const users: Record<'owner' | 'plain' | 'admin' | 'foreign', SessionUser> = {} as never;
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
    isDrohnengruppeMember: true,
    droneGroupId: group.id,
    droneGroupRole: 'PILOT',
    ...overrides,
  };
}

async function makeUser(key: keyof typeof users, groupId: string, role: 'PILOT' | 'ADMIN') {
  const created = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      homeOrganizationId,
      isActive: true,
      droneMembership: { create: { droneGroupId: groupId, role } },
    },
  });
  userIds.push(created.id);
  users[key] = sessionUser(created.id, { droneGroupId: groupId, droneGroupRole: role });
}

beforeAll(async () => {
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true, featureChecklist: true } });
  otherGroup = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Kirchberg' }, select: { id: true, organizationId: true, featureChecklist: true } });
  homeOrganizationId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;
  await makeUser('owner', group.id, 'PILOT');
  await makeUser('plain', group.id, 'PILOT');
  await makeUser('admin', group.id, 'ADMIN');
  await makeUser('foreign', otherGroup.id, 'PILOT');
  drone = await prisma.drone.create({ data: { name: `${RUN}-d1`, droneGroupId: group.id } });
});

afterAll(async () => {
  await prisma.droneFlight.deleteMany({ where: { registeredById: { in: userIds } } });
  await prisma.droneChecklist.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.drone.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

let counter = 0;
async function checklist(
  by: keyof typeof users,
  status: 'DRAFT' | 'SUBMITTED' | 'DISCARDED',
  extra: { area?: string; purpose?: string; groupId?: string; updatedAt?: Date } = {},
) {
  counter += 1;
  const row = await prisma.droneChecklist.create({
    data: {
      droneGroupId: extra.groupId ?? group.id,
      createdById: users[by].id,
      pilotId: users[by].id,
      status,
      flightAt: new Date('2026-06-15T08:00:00Z'),
      purpose: extra.purpose ?? 'EINSATZ',
      area: extra.area ?? `Gebiet ${RUN} ${counter}`,
      step: 3,
      submittedAt: status === 'SUBMITTED' ? new Date() : null,
      submittedById: status === 'SUBMITTED' ? users[by].id : null,
      data: { pilot: users[by].id } as Prisma.InputJsonValue,
    },
  });
  if (extra.updatedAt) {
    await prisma.$executeRaw`UPDATE "DroneChecklist" SET "updatedAt" = ${extra.updatedAt} WHERE id = ${row.id}`;
  }
  return row.id;
}

describe('checklistTitle', () => {
  it('kombiniert Art und Fluggebiet mit Ersatztexten', () => {
    expect(checklistTitle({ purpose: 'EINSATZ', area: 'Steinbruch' })).toBe('Einsatz · Steinbruch');
    expect(checklistTitle({ purpose: 'TRAINING', area: null })).toBe('Training · ohne Fluggebiet');
    expect(checklistTitle({ purpose: null, area: 'X' })).toBe('Flug · X');
  });
});

describe('listGroupDrafts', () => {
  it('zeigt jedem Gruppenmitglied alle Entwürfe, eigene zuerst, ohne abgegebene/verworfene', async () => {
    const mine = await checklist('owner', 'DRAFT', { updatedAt: new Date('2026-01-01') });
    const theirs = await checklist('plain', 'DRAFT', { updatedAt: new Date('2026-03-01') });
    const submittedOne = await checklist('plain', 'SUBMITTED');
    const discarded = await checklist('plain', 'DISCARDED');
    const list = await listGroupDrafts(users.owner, group.id);
    const ids = list.map((i) => i.id);
    expect(ids).toContain(mine);
    expect(ids).toContain(theirs);
    expect(ids).not.toContain(submittedOne);
    expect(ids).not.toContain(discarded);
    expect(ids.indexOf(mine)).toBeLessThan(ids.indexOf(theirs));
    expect(list.find((i) => i.id === mine)).toMatchObject({ isOwn: true, step: 3 });
    expect(list.find((i) => i.id === theirs)).toMatchObject({ isOwn: false });
  });

  it('liefert Mitgliedern einer anderen Gruppe nichts', async () => {
    expect(await listGroupDrafts(users.foreign, group.id)).toEqual([]);
  });
});

describe('listChecklistsForFlight', () => {
  it('liefert höchstens 4, neueste Änderung zuerst, nie verworfene', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await checklist('admin', 'DRAFT', { updatedAt: new Date(`2027-01-0${i + 1}`) }));
    await checklist('admin', 'DISCARDED', { updatedAt: new Date('2028-01-01') });
    const options = await listChecklistsForFlight(users.admin, group);
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.id)).toEqual([ids[4], ids[3], ids[2], ids[1]]);
    expect(options.every((o) => o.status !== 'DISCARDED')).toBe(true);
  });

  it('zeigt einem Mitglied fremde ABGEGEBENE Checklisten nicht, fremde Entwürfe schon', async () => {
    const submittedOfAdmin = await checklist('admin', 'SUBMITTED', { updatedAt: new Date('2030-01-01') });
    const draftOfAdmin = await checklist('admin', 'DRAFT', { updatedAt: new Date('2030-01-02') });
    const ids = (await listChecklistsForFlight(users.plain, group)).map((o) => o.id);
    expect(ids).toContain(draftOfAdmin);
    expect(ids).not.toContain(submittedOfAdmin);
  });

  it('nennt Titel, Pilot und die Anzahl verknüpfter Flüge', async () => {
    const id = await checklist('owner', 'SUBMITTED', { area: `Steinbruch ${RUN}`, updatedAt: new Date('2031-01-01') });
    await prisma.droneFlight.create({
      data: {
        startsAt: new Date('2026-06-15T08:00:00Z'),
        pilotUserId: users.owner.id,
        location: 'x',
        droneId: drone.id,
        purpose: 'EINSATZ',
        registeredById: users.owner.id,
        checklistId: id,
      },
    });
    const option = (await listChecklistsForFlight(users.owner, group)).find((o) => o.id === id);
    expect(option).toMatchObject({ title: `Einsatz · Steinbruch ${RUN}`, status: 'SUBMITTED', pilotName: `owner ${RUN}`, linkedFlights: 1 });
    expect(option?.defaults).toEqual({ startsAt: '2026-06-15T10:00', pilotUserId: users.owner.id });
  });
});

describe('resolveLinkableChecklist', () => {
  it('erlaubt die eigene abgegebene Checkliste, nicht aber fremde abgegebene, verworfene oder die einer anderen Gruppe', async () => {
    const own = await checklist('owner', 'SUBMITTED');
    const foreignSubmitted = await checklist('admin', 'SUBMITTED');
    const discarded = await checklist('owner', 'DISCARDED');
    const otherGroupDraft = await checklist('foreign', 'DRAFT', { groupId: otherGroup.id });
    expect(await resolveLinkableChecklist(users.owner, group.id, own)).toBe(true);
    expect(await resolveLinkableChecklist(users.owner, group.id, foreignSubmitted)).toBe(false);
    expect(await resolveLinkableChecklist(users.owner, group.id, discarded)).toBe(false);
    expect(await resolveLinkableChecklist(users.owner, group.id, otherGroupDraft)).toBe(false);
    expect(await resolveLinkableChecklist(users.admin, group.id, foreignSubmitted)).toBe(true);
    expect(await resolveLinkableChecklist(users.owner, group.id, 'gibt-es-nicht')).toBe(false);
  });
});

describe('checklistCounts / listChecklistsAdmin', () => {
  it('zählt je Status und filtert/paginiert die Liste, neueste zuerst', async () => {
    const before = await checklistCounts(group.id);
    const d = await checklist('owner', 'DRAFT', { updatedAt: new Date('2040-01-01') });
    const s = await checklist('owner', 'SUBMITTED', { updatedAt: new Date('2040-01-02') });
    const x = await checklist('owner', 'DISCARDED', { updatedAt: new Date('2040-01-03') });
    const after = await checklistCounts(group.id);
    expect(after.drafts).toBe(before.drafts + 1);
    expect(after.submitted).toBe(before.submitted + 1);
    expect(after.discarded).toBe(before.discarded + 1);

    const all = await listChecklistsAdmin(group.id, { page: 1, pageSize: 3 });
    expect(all.total).toBe(after.drafts + after.submitted + after.discarded);
    expect(all.items.map((i) => i.id)).toEqual([x, s, d]);

    const onlySubmitted = await listChecklistsAdmin(group.id, { status: 'SUBMITTED', page: 1, pageSize: 25 });
    expect(onlySubmitted.items.every((i) => i.status === 'SUBMITTED')).toBe(true);
    expect(onlySubmitted.items[0].id).toBe(s);
    expect(onlySubmitted.items[0]).toMatchObject({ pilotName: `owner ${RUN}`, linkedFlights: 0 });

    const page2 = await listChecklistsAdmin(group.id, { page: 2, pageSize: 1 });
    expect(page2.items).toHaveLength(1);
  });
});

describe('getChecklistView', () => {
  it('liefert Entwurf mit Bearbeitungsrechten für den Ersteller, nicht für ein fremdes Mitglied ohne BOS1', async () => {
    const id = await checklist('owner', 'DRAFT');
    const own = await getChecklistView(users.owner, id);
    expect(own).toMatchObject({ canEdit: true, canDiscard: true, canConfirm: true, canConfirmAny: false });
    const other = await getChecklistView(users.plain, id);
    expect(other).toMatchObject({ canEdit: false, canDiscard: false, canConfirm: false });
    expect(other?.checklist.id).toBe(id);
  });

  it('gibt dem Admin der Gruppe alle Rechte, auch auf fremde Entwürfe', async () => {
    const id = await checklist('owner', 'DRAFT');
    expect(await getChecklistView(users.admin, id)).toMatchObject({ canEdit: true, canDiscard: true, canConfirm: true, canConfirmAny: true });
  });

  it('liefert null für fremde Gruppen, fremde abgegebene Checklisten und unbekannte Ids', async () => {
    const draft = await checklist('owner', 'DRAFT');
    const submittedOne = await checklist('owner', 'SUBMITTED');
    expect(await getChecklistView(users.foreign, draft)).toBeNull();
    expect(await getChecklistView(users.plain, submittedOne)).toBeNull();
    expect(await getChecklistView(users.owner, 'gibt-es-nicht')).toBeNull();
  });

  it('lässt auch den Ersteller eine abgegebene Checkliste nur lesen', async () => {
    const id = await checklist('owner', 'SUBMITTED');
    expect(await getChecklistView(users.owner, id)).toMatchObject({ canEdit: false, canDiscard: false });
  });
});
