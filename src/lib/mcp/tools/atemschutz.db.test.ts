import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getAtemschutzStatus } from './atemschutz';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-as-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let orgA: { id: string };
let orgB: { id: string };
const ids: Record<string, string> = {};

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown>) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: organizationId, ...extra },
  });
  ids[key] = user.id;
}

beforeAll(async () => {
  // Nur Feuerwehren mit aktiviertem Funktionsschalter Atemschutz (wie die App-Ansicht).
  [orgA, orgB] = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', isActive: true, featureAtemschutz: true },
    orderBy: { name: 'asc' },
    take: 2,
  });
  await makeUser('aktiv', orgA.id, {
    istAtemschutzgeraeteTraeger: true,
    atemschutzGueltigBis: new Date(Date.now() + 400 * DAY),
    atemschutzFinnentestAm: new Date(Date.now() - 10 * DAY),
  });
  await makeUser('abgelaufen', orgA.id, {
    istAtemschutzgeraeteTraeger: true,
    atemschutzGueltigBis: new Date(Date.now() - 5 * DAY),
    atemschutzFinnentestAm: new Date(Date.now() - 10 * DAY),
  });
  await makeUser('keintraeger', orgA.id, { istAtemschutzgeraeteTraeger: false });
  await makeUser('fremd', orgB.id, { istAtemschutzgeraeteTraeger: true, atemschutzGueltigBis: new Date(Date.now() + 400 * DAY) });
  await makeUser('deaktiviert', orgA.id, {
    istAtemschutzgeraeteTraeger: true,
    isActive: false,
    passwordChangedAt: new Date('2026-01-01'),
    atemschutzGueltigBis: new Date(Date.now() + 400 * DAY),
  });
});

afterAll(async () => {
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

type Item = { id: string; gesamtStatus: string };
type Result = { eigener: { gesamtStatus: string } | null; liste?: { items: Item[]; nextCursor: string | null } };
const call = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
  (await getAtemschutzStatus.handler({ principal: principalFixture(user) }, input)).data as Result;

/** Liest alle Seiten der Liste (die lokale Datenbank kann weitere Träger enthalten als die Testdaten). */
async function collect(user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const data = (await getAtemschutzStatus.handler({ principal: principalFixture(user) }, { ...input, limit: 50, cursor })).data as Result;
    items.push(...(data.liste?.items ?? []));
    cursor = data.liste?.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

describe('get_atemschutz_status', () => {
  it('zeigt jedem Träger den eigenen Status, ohne Liste', async () => {
    const result = await call(sessionUserFixture({ id: ids.aktiv, homeOrganizationId: orgA.id }));
    expect(result.eigener?.gesamtStatus).toBe('aktiv');
    expect(result.liste).toBeUndefined();
  });

  it('liefert für Nicht-Träger eigener = null', async () => {
    const result = await call(sessionUserFixture({ id: ids.keintraeger, homeOrganizationId: orgA.id }));
    expect(result.eigener).toBeNull();
  });

  it('zeigt einem Feuerwehr-Admin die Träger der eigenen Feuerwehr (ohne Nicht-Träger, ohne Deaktivierte, ohne fremde Feuerwehr)', async () => {
    const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
    const items = await collect(admin);
    const mine = items.filter((i) => Object.values(ids).includes(i.id)).map((i) => i.id).sort();
    expect(mine).toEqual([ids.aktiv, ids.abgelaufen].sort());
  });

  it('filtert nach Status', async () => {
    const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
    const items = await collect(admin, { status: 'abgelaufen' });
    expect(items.map((i) => i.id)).toContain(ids.abgelaufen);
    expect(items.map((i) => i.id)).not.toContain(ids.aktiv);
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs ab', async () => {
    const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
    await expect(getAtemschutzStatus.handler({ principal: principalFixture(admin) }, { organizationId: orgB.id })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('verlangt von einem Bezirksadmin eine Feuerwehr (sonst wäre die Liste riesig)', async () => {
    const admin = sessionUserFixture({ id: 'admin-y', isBezirksAdmin: true });
    const result = await call(admin);
    expect(result.liste).toBeUndefined();
    const withOrg = await collect(admin, { organizationId: orgB.id });
    expect(withOrg.map((i) => i.id)).toContain(ids.fremd);
  });

  it('blendet alles aus, wenn die Feuerwehr den Funktionsschalter Atemschutz abgeschaltet hat (wie die App)', async () => {
    await prisma.organization.update({ where: { id: orgA.id }, data: { featureAtemschutz: false } });
    try {
      const own = await call(sessionUserFixture({ id: ids.aktiv, homeOrganizationId: orgA.id }));
      expect(own.eigener).toBeNull();
      const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
      const items = await collect(admin);
      expect(items.map((i) => i.id)).not.toContain(ids.aktiv);
    } finally {
      await prisma.organization.update({ where: { id: orgA.id }, data: { featureAtemschutz: true } });
    }
  });
});
