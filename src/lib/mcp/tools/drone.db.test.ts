import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getDroneReadiness, listDroneFlights } from './drone';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-drone-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let group: { id: string; organizationId: string };
let otherGroup: { id: string };
let drone: { id: string };
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

async function flight(pilotKey: string, daysAgo: number, location: string) {
  await prisma.droneFlight.create({
    data: {
      startsAt: new Date(Date.now() - daysAgo * DAY),
      pilotUserId: ids[pilotKey],
      location: `${RUN} ${location}`,
      droneId: drone.id,
      purpose: 'UEBUNG',
      registeredById: ids[pilotKey],
    },
  });
}

beforeAll(async () => {
  const found = await prisma.droneGroup.findFirst({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true } });
  if (!found) throw new Error('Testvoraussetzung fehlt: Drohnengruppe "AFKDO Purkersdorf" nicht in der lokalen Datenbank (npm run db:seed).');
  group = found;
  const other = await prisma.droneGroup.findFirst({ where: { id: { not: group.id } }, select: { id: true } });
  if (!other) throw new Error('Testvoraussetzung fehlt: mindestens zwei Drohnengruppen in der lokalen Datenbank (npm run db:seed).');
  otherGroup = other;
  drone = await prisma.drone.create({ data: { name: `${RUN}-d`, droneGroupId: group.id } });
  await makeUser('pilot', group.id, 'PILOT', true);
  await makeUser('kollege', group.id, 'PILOT');
  await makeUser('admin', group.id, 'ADMIN');
  await makeUser('fremd', otherGroup.id);
  await makeUser('ohne', null);
  await flight('pilot', 5, 'A');
  await flight('pilot', 20, 'B');
  await flight('pilot', 200, 'alt');
  await flight('kollege', 7, 'C');
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
    expect(await flights(memberUser('admin', 'ADMIN'), { droneGroupId: group.id })).toHaveLength(4);
  });

  it('begrenzt den Zeitraum', async () => {
    const places = await flights(memberUser('admin', 'ADMIN'), { from: new Date(Date.now() - 30 * DAY).toISOString(), droneGroupId: group.id });
    expect(places).toHaveLength(3);
  });

  it('filtert Admins nach Pilot', async () => {
    const places = await flights(memberUser('admin', 'ADMIN'), { droneGroupId: group.id, pilotId: ids.kollege });
    expect(places).toEqual([`${RUN} C`]);
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
