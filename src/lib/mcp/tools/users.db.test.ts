import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { principalFixture, sessionUserFixture } from './test-support';
import { getUser, listUsers } from './users';

const RUN = `mcp-users-${Date.now()}`;
let orgA: { id: string };
let orgB: { id: string };
const ids: Record<string, string> = {};

async function makeUser(key: string, organizationId: string, extra: { isActive?: boolean; passwordChangedAt?: Date | null } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'geheim-hash',
      firstName: key,
      lastName: RUN,
      stbNr: '77',
      phone: '+436601234567',
      homeOrganizationId: organizationId,
      isActive: extra.isActive ?? true,
      passwordChangedAt: extra.passwordChangedAt ?? null,
    },
  });
  ids[key] = user.id;
}

beforeAll(async () => {
  const orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 2 });
  [orgA, orgB] = orgs;
  await makeUser('aktiv', orgA.id);
  await makeUser('inaktiv', orgA.id, { isActive: false });
  await makeUser('deaktiviert', orgA.id, { isActive: false, passwordChangedAt: new Date('2026-01-01') });
  await makeUser('fremd', orgB.id);
});

afterAll(async () => {
  const created = Object.values(ids);
  if (created.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});

const asAdmin = (orgIds: string[]) => principalFixture(sessionUserFixture({ feuerwehrAdminOrgIds: orgIds }));
const run = async (principal: ReturnType<typeof asAdmin>, input: Record<string, unknown> = {}) =>
  (await listUsers.handler({ principal }, input)).data as { items: { id: string; status: string; email: string }[]; nextCursor: string | null };

describe('list_users', () => {
  it('zeigt einem Feuerwehr-Admin nur Benutzer der eigenen Feuerwehr, mit korrektem Status', async () => {
    const result = await run(asAdmin([orgA.id]), { query: RUN });
    expect(result.items.map((u) => u.id).sort()).toEqual([ids.aktiv, ids.inaktiv, ids.deaktiviert].sort());
    const byId = Object.fromEntries(result.items.map((u) => [u.id, u.status]));
    expect(byId[ids.aktiv]).toBe('aktiv');
    expect(byId[ids.inaktiv]).toBe('inaktiv');
    expect(byId[ids.deaktiviert]).toBe('deaktiviert');
  });

  it('zeigt einem Bezirksadmin auch Benutzer anderer Feuerwehren', async () => {
    const principal = principalFixture(sessionUserFixture({ isBezirksAdmin: true }));
    const result = await run(principal, { query: RUN });
    expect(result.items).toHaveLength(4);
  });

  it('filtert nach Status und Feuerwehr', async () => {
    const principal = principalFixture(sessionUserFixture({ isBezirksAdmin: true }));
    expect((await run(principal, { query: RUN, status: 'deaktiviert' })).items.map((u) => u.id)).toEqual([ids.deaktiviert]);
    expect((await run(principal, { query: RUN, organizationId: orgB.id })).items.map((u) => u.id)).toEqual([ids.fremd]);
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs ab', async () => {
    await expect(listUsers.handler({ principal: asAdmin([orgA.id]) }, { organizationId: orgB.id })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('lehnt Mitglieder ohne Verwaltungsrecht ab', async () => {
    await expect(listUsers.handler({ principal: principalFixture(sessionUserFixture()) }, {})).rejects.toMatchObject({ kind: 'denied' });
  });

  it('gibt weder Passwort-Hash noch Token aus und blättert mit Cursor', async () => {
    const principal = principalFixture(sessionUserFixture({ isBezirksAdmin: true }));
    const first = (await listUsers.handler({ principal }, { query: RUN, limit: 3 })).data as { items: object[]; nextCursor: string | null };
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/passwordHash|geheim-hash|icsToken/);
    const second = (await listUsers.handler({ principal }, { query: RUN, limit: 3, cursor: first.nextCursor! })).data as {
      items: object[];
      nextCursor: string | null;
    };
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe('get_user', () => {
  it('liefert einem Admin den Benutzer seiner Feuerwehr samt Ausbildung', async () => {
    const result = (await getUser.handler({ principal: asAdmin([orgA.id]) }, { userId: ids.aktiv })).data as { id: string; ausbildung: object };
    expect(result.id).toBe(ids.aktiv);
    expect(result.ausbildung).toEqual({ a1a3Lizenz: null, a2Lizenz: null, stuetzpunktausbildung: null, bos1: null, bos2: null });
  });

  it('antwortet für Benutzer außerhalb des Bereichs wie für unbekannte: nicht gefunden', async () => {
    await expect(getUser.handler({ principal: asAdmin([orgA.id]) }, { userId: ids.fremd })).rejects.toMatchObject({ message: 'Benutzer wurde nicht gefunden.' });
    await expect(getUser.handler({ principal: asAdmin([orgA.id]) }, { userId: 'gibt-es-nicht' })).rejects.toMatchObject({ message: 'Benutzer wurde nicht gefunden.' });
  });

  it('lehnt Mitglieder ohne Verwaltungsrecht ab', async () => {
    await expect(getUser.handler({ principal: principalFixture(sessionUserFixture()) }, { userId: ids.aktiv })).rejects.toMatchObject({ kind: 'denied' });
  });
});
