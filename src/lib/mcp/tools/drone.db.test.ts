import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getDroneReadiness, listDroneFlights } from './drone';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-drone-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let group: { id: string; organizationId: string };
let otherGroup: { id: string; organizationId: string };
let drone: { id: string };
let otherDrone: { id: string };
const ids: Record<string, string> = {};

async function makeUser(key: string, groupId: string | null, role: 'PILOT' | 'ADMIN' = 'PILOT', bos1 = false) {
  const org = await prisma.organization.findFirst({ where: { type: 'FEUERWEHR' } });
  if (!org) throw new Error('Testvoraussetzung fehlt: keine Feuerwehr in der lokalen Datenbank (npm run db:seed).');
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      homeOrganizationId: org.id,
      ...(groupId
        ? {
            droneMembership: {
              create: {
                droneGroupId: groupId,
                role,
                ...(bos1
                  ? { a1a3LizenzAm: new Date('2025-01-01'), a2LizenzAm: new Date('2025-02-01'), stuetzpunktausbildungAm: new Date('2025-03-01'), bos1AusbildungAm: new Date('2025-04-01') }
                  : {}),
              },
            },
          }
        : {}),
    },
  });
  ids[key] = user.id;
}

async function flight(pilotKey: string, daysAgo: number, location: string, opts: { registeredBy?: string; droneId?: string } = {}) {
  await prisma.droneFlight.create({
    data: {
      startsAt: new Date(Date.now() - daysAgo * DAY),
      pilotUserId: ids[pilotKey],
      location: `${RUN} ${location}`,
      droneId: opts.droneId ?? drone.id,
      purpose: 'UEBUNG',
      registeredById: ids[opts.registeredBy ?? pilotKey],
    },
  });
}

beforeAll(async () => {
  const found = await prisma.droneGroup.findFirst({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true } });
  if (!found) throw new Error('Testvoraussetzung fehlt: Drohnengruppe "AFKDO Purkersdorf" nicht in der lokalen Datenbank (npm run db:seed).');
  group = found;
  // Andere Gruppe an einem ANDEREN Abschnitt: sonst wäre der Abschnittsadmin-Test nicht aussagekräftig.
  const other = await prisma.droneGroup.findFirst({ where: { organizationId: { not: group.organizationId } }, select: { id: true, organizationId: true } });
  if (!other) throw new Error('Testvoraussetzung fehlt: eine zweite Drohnengruppe an einem anderen Abschnitt in der lokalen Datenbank (npm run db:seed).');
  otherGroup = other;
  drone = await prisma.drone.create({ data: { name: `${RUN}-d`, droneGroupId: group.id } });
  otherDrone = await prisma.drone.create({ data: { name: `${RUN}-d2`, droneGroupId: otherGroup.id } });
  await makeUser('pilot', group.id, 'PILOT', true);
  await makeUser('kollege', group.id, 'PILOT');
  await makeUser('admin', group.id, 'ADMIN');
  await makeUser('gast', group.id);
  await makeUser('fremd', otherGroup.id);
  await makeUser('ohne', null);
  await flight('pilot', 5, 'A');
  await flight('pilot', 20, 'B');
  await flight('pilot', 200, 'alt');
  await flight('kollege', 7, 'C');
  // Von 'kollege' für jemand anderen erfasst: nur die registeredBy-Hälfte der Eigene-Flüge-Regel führt zu 'kollege'.
  await flight('gast', 9, 'D', { registeredBy: 'kollege' });
  await flight('fremd', 11, 'F', { droneId: otherDrone.id });
});

afterAll(async () => {
  await prisma.droneFlight.deleteMany({ where: { location: { startsWith: RUN } } });
  await prisma.drone.deleteMany({ where: { name: { startsWith: RUN } } });
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

const memberUser = (key: string, role: 'PILOT' | 'ADMIN' = 'PILOT') =>
  sessionUserFixture({ id: ids[key], isDrohnengruppeMember: true, droneGroupId: group.id, droneGroupRole: role, abschnittAdminOrgIds: [], feuerwehrAdminOrgIds: [] });

type Flights = { items: { id: string; ort: string; pilot: string }[]; nextCursor: string | null };
// Der Zeitraum darf höchstens 366 Tage umfassen: 300 Tage zurück deckt alle Testflüge (5, 7, 20 und 200 Tage) ab.
const WIDE = { from: new Date(Date.now() - 300 * DAY).toISOString(), to: new Date(Date.now() + DAY).toISOString() };

/** Liest alle Seiten (die lokale Datenbank kann weitere Flüge enthalten) und liefert nur die Testflüge. */
async function flights(user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}): Promise<string[]> {
  const places: string[] = [];
  let cursor: string | undefined;
  do {
    const data = (await listDroneFlights.handler({ principal: principalFixture(user) }, { ...WIDE, ...input, limit: 50, cursor })).data as Flights;
    places.push(...data.items.map((f) => f.ort).filter((o) => o.startsWith(RUN)));
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return places;
}

describe('list_drone_flights', () => {
  it('zeigt einem Mitglied nur die eigenen Flüge im Zeitraum', async () => {
    const places = await flights(memberUser('pilot'));
    expect(places.sort()).toEqual([`${RUN} A`, `${RUN} B`, `${RUN} alt`].sort());
  });

  it('zeigt einem Gruppenadmin alle Flüge der Gruppe', async () => {
    expect(await flights(memberUser('admin', 'ADMIN'), { droneGroupId: group.id })).toHaveLength(5);
  });

  it('begrenzt den Zeitraum', async () => {
    const places = await flights(memberUser('admin', 'ADMIN'), { from: new Date(Date.now() - 30 * DAY).toISOString(), droneGroupId: group.id });
    expect(places).toHaveLength(4);
  });

  it('filtert Admins nach Pilot', async () => {
    const places = await flights(memberUser('admin', 'ADMIN'), { droneGroupId: group.id, pilotId: ids.kollege });
    expect(places).toEqual([`${RUN} C`]);
  });

  it('liefert Beginn als Wiener Ortszeit mit Offset und das Datum als Wiener Kalendertag', async () => {
    const created = await prisma.droneFlight.create({
      data: {
        startsAt: new Date('2030-06-15T22:30:00Z'),
        pilotUserId: ids.pilot,
        location: `${RUN} spaet`,
        droneId: drone.id,
        purpose: 'UEBUNG',
        registeredById: ids.pilot,
      },
    });
    try {
      const data = (await listDroneFlights.handler({ principal: principalFixture(memberUser('pilot')) }, { from: '2030-06-01', to: '2030-06-30' })).data as {
        items: { id: string; datum: string; beginn: string }[];
      };
      const item = data.items.find((f) => f.id === created.id);
      expect(item).toMatchObject({ datum: '2030-06-16', beginn: '2030-06-16T00:30:00+02:00' });
    } finally {
      await prisma.droneFlight.deleteMany({ where: { id: created.id } });
    }
  });

  it('lehnt Benutzer ohne Zugriff auf das Drohnenmodul und fremde Gruppen ab', async () => {
    await expect(listDroneFlights.handler({ principal: principalFixture(sessionUserFixture({ id: ids.ohne })) }, WIDE)).rejects.toMatchObject({ kind: 'denied' });
    await expect(
      listDroneFlights.handler({ principal: principalFixture(memberUser('admin', 'ADMIN')) }, { ...WIDE, droneGroupId: otherGroup.id }),
    ).rejects.toMatchObject({ kind: 'denied' });
    await expect(
      listDroneFlights.handler({ principal: principalFixture(memberUser('pilot')) }, { ...WIDE, droneGroupId: otherGroup.id }),
    ).rejects.toMatchObject({ kind: 'denied' });
  });

  it('verlangt einen gültigen Zeitraum von höchstens 366 Tagen', async () => {
    await expect(listDroneFlights.handler({ principal: principalFixture(memberUser('pilot')) }, { from: '2024-01-01', to: '2026-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(listDroneFlights.handler({ principal: principalFixture(memberUser('pilot')) }, { from: 'kaputt', to: '2026-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('get_drone_readiness', () => {
  type Ready = {
    eigener: { fluegeImFenster: number; regelErfuellt: boolean; status: string; gueltigBis: string | null };
    gruppe?: { piloten: { id: string; fluege: number; status: string }[] };
  };
  const readiness = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
    (await getDroneReadiness.handler({ principal: principalFixture(user) }, input)).data as Ready;

  it('zeigt jedem Mitglied den eigenen 90-Tage-Status (nur Flüge im Fenster)', async () => {
    const result = await readiness(memberUser('pilot'));
    expect(result.eigener.fluegeImFenster).toBe(2);
    expect(result.eigener.regelErfuellt).toBe(false);
    expect(result.eigener.status).toBe('GELB');
    expect(result.eigener.gueltigBis).toBeNull();
    expect(result.gruppe).toBeUndefined();
  });

  it('zeigt Gruppenadmins zusätzlich die Ampel je BOS1-Pilot', async () => {
    const result = await readiness(memberUser('admin', 'ADMIN'), { droneGroupId: group.id });
    const pilot = result.gruppe!.piloten.find((p) => p.id === ids.pilot);
    expect(pilot).toMatchObject({ fluege: 2, status: 'GELB' });
  });

  it('lehnt Benutzer ohne Drohnenmodul und fremde Gruppen ab', async () => {
    await expect(getDroneReadiness.handler({ principal: principalFixture(sessionUserFixture({ id: ids.ohne })) }, {})).rejects.toMatchObject({ kind: 'denied' });
    await expect(
      getDroneReadiness.handler({ principal: principalFixture(memberUser('admin', 'ADMIN')) }, { droneGroupId: otherGroup.id }),
    ).rejects.toMatchObject({ kind: 'denied' });
  });
});

describe('Rollenmatrix', () => {
  const placesOf = (rows: string[]) => rows.map((o) => o.slice(RUN.length + 1)).sort();
  const readiness = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
    (await getDroneReadiness.handler({ principal: principalFixture(user) }, input)).data as {
      eigener: { fluegeImFenster: number };
      gruppe?: { name: string; piloten: { id: string }[] };
    };
  const fremdUser = () =>
    sessionUserFixture({ id: ids.fremd, isDrohnengruppeMember: true, droneGroupId: otherGroup.id, droneGroupRole: 'PILOT' });

  it('Mitglied einer anderen Gruppe sieht nur die eigenen Flüge, Flüge der Gruppe A bleiben verborgen', async () => {
    expect(placesOf(await flights(fremdUser()))).toEqual(['F']);
    const result = await readiness(fremdUser());
    expect(result.eigener.fluegeImFenster).toBe(1);
    expect(result.gruppe).toBeUndefined();
  });

  it('Mitglied einer anderen Gruppe wird für die Gruppe A abgelehnt (Flugbuch und 90-Tage-Status)', async () => {
    await expect(listDroneFlights.handler({ principal: principalFixture(fremdUser()) }, { ...WIDE, droneGroupId: group.id })).rejects.toMatchObject({ kind: 'denied' });
    await expect(getDroneReadiness.handler({ principal: principalFixture(fremdUser()) }, { droneGroupId: group.id })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('Bezirksadmin ohne Zugriff auf das Drohnenmodul wird abgelehnt (wie in der App)', async () => {
    const bezirksadmin = sessionUserFixture({ id: ids.ohne, isBezirksAdmin: true });
    await expect(listDroneFlights.handler({ principal: principalFixture(bezirksadmin) }, WIDE)).rejects.toMatchObject({ kind: 'denied' });
    await expect(getDroneReadiness.handler({ principal: principalFixture(bezirksadmin) }, {})).rejects.toMatchObject({ kind: 'denied' });
  });

  it('Bezirks-Drohnenadmin darf jede Gruppe wählen und sieht genau deren Flüge', async () => {
    const admin = sessionUserFixture({ id: ids.ohne, isBezirksDrohnenAdmin: true });
    expect(placesOf(await flights(admin, { droneGroupId: group.id }))).toEqual(['A', 'B', 'C', 'D', 'alt']);
    expect(placesOf(await flights(admin, { droneGroupId: otherGroup.id }))).toEqual(['F']);
    const ready = await readiness(admin, { droneGroupId: group.id });
    expect(ready.gruppe!.piloten.some((p) => p.id === ids.pilot)).toBe(true);
    const readyOther = await readiness(admin, { droneGroupId: otherGroup.id });
    expect(readyOther.gruppe!.piloten.some((p) => p.id === ids.pilot)).toBe(false);
  });

  it('Mitglied sieht auch Flüge, die es für andere erfasst hat (registeredBy), aber nicht fremde', async () => {
    expect(placesOf(await flights(memberUser('kollege')))).toEqual(['C', 'D']);
  });

  it('pilotId wirkt bei Mitgliedern als UND innerhalb der eigenen Flüge', async () => {
    const kollege = memberUser('kollege');
    expect(placesOf(await flights(kollege, { pilotId: ids.gast }))).toEqual(['D']);
    expect(placesOf(await flights(kollege, { pilotId: ids.kollege }))).toEqual(['C']);
    // Flüge anderer Piloten, an denen das Mitglied nicht beteiligt ist, bleiben auch mit pilotId unsichtbar.
    expect(await flights(kollege, { pilotId: ids.pilot })).toEqual([]);
  });

  it('Mitglied darf im 90-Tage-Status keine fremde droneGroupId angeben', async () => {
    await expect(getDroneReadiness.handler({ principal: principalFixture(memberUser('pilot')) }, { droneGroupId: otherGroup.id })).rejects.toMatchObject({ kind: 'denied' });
    // Die eigene Gruppe ist erlaubt und liefert weiterhin nur den eigenen Status.
    expect((await readiness(memberUser('pilot'), { droneGroupId: group.id })).gruppe).toBeUndefined();
  });

  it('Abschnittsadmin des Abschnitts der Gruppe sieht deren Flüge, aber keine Gruppe anderer Abschnitte', async () => {
    // Mitglied der anderen Gruppe (Zugang zum Modul) mit Admin-Recht am Abschnitt der Gruppe A.
    const abschnittsadmin = sessionUserFixture({
      id: ids.fremd,
      isDrohnengruppeMember: true,
      droneGroupId: otherGroup.id,
      droneGroupRole: 'PILOT',
      abschnittAdminOrgIds: [group.organizationId],
      feuerwehrAdminOrgIds: [group.organizationId],
    });
    expect(placesOf(await flights(abschnittsadmin, { droneGroupId: group.id }))).toEqual(['A', 'B', 'C', 'D', 'alt']);
    const ready = await readiness(abschnittsadmin, { droneGroupId: group.id });
    expect(ready.gruppe!.piloten.some((p) => p.id === ids.pilot)).toBe(true);
    await expect(listDroneFlights.handler({ principal: principalFixture(abschnittsadmin) }, { ...WIDE, droneGroupId: otherGroup.id })).rejects.toMatchObject({ kind: 'denied' });
    await expect(getDroneReadiness.handler({ principal: principalFixture(abschnittsadmin) }, { droneGroupId: otherGroup.id })).rejects.toMatchObject({ kind: 'denied' });
  });
});
