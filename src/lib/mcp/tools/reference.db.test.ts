import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { principalFixture, sessionUserFixture } from './test-support';
import { listDienstgrade, listOrganizations } from './reference';

let orgs: { id: string; name: string }[];

beforeAll(async () => {
  orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 3, select: { id: true, name: true } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const call = (user = sessionUserFixture(), input: Record<string, unknown> = {}) =>
  listOrganizations.handler({ principal: principalFixture(user) }, input);

describe('list_organizations', () => {
  it('zeigt einem Bezirksadmin alle aktiven Organisationen (Seiten zu höchstens 50)', async () => {
    const result = (await call(sessionUserFixture({ isBezirksAdmin: true }), {})).data as { items: unknown[]; nextCursor: string | null };
    expect(result.items.length).toBe(25);
    expect(result.nextCursor).not.toBeNull();
    const big = (await call(sessionUserFixture({ isBezirksAdmin: true }), { limit: 50 })).data as { items: unknown[]; nextCursor: string | null };
    expect(big.items.length).toBe(50);
    expect(big.nextCursor).not.toBeNull();
  });

  it('zeigt einem Feuerwehr-Admin nur seine Organisationen', async () => {
    const admin = sessionUserFixture({ feuerwehrAdminOrgIds: [orgs[0].id] });
    const result = (await call(admin)).data as { items: { id: string }[]; nextCursor: string | null };
    expect(result.items.map((o) => o.id)).toEqual([orgs[0].id]);
    expect(result.nextCursor).toBeNull();
  });

  it('liefert einem Mitglied ohne Verwaltungsbereich eine leere Liste', async () => {
    const result = (await call(sessionUserFixture())).data as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  it('filtert nach Suchtext ohne Rücksicht auf Groß-/Kleinschreibung', async () => {
    const admin = sessionUserFixture({ isBezirksAdmin: true });
    const result = (await call(admin, { query: orgs[1].name.toUpperCase() })).data as { items: { id: string }[] };
    expect(result.items.some((o) => o.id === orgs[1].id)).toBe(true);
  });
});

describe('list_dienstgrade', () => {
  it('liefert die Dienstgrade in der Rangfolge', async () => {
    const result = (await listDienstgrade.handler({ principal: principalFixture(sessionUserFixture()) }, {})).data as {
      items: { id: string; kurzform: string }[];
    };
    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items[0]).toHaveProperty('kurzform');
    expect(result.items[0]).toHaveProperty('bezeichnung');
  });
});
