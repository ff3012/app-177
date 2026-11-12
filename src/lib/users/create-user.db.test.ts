import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// createToken läuft unverändert, lässt sich aber für EINEN Aufruf zum Scheitern bringen (letzter Schritt der Transaktion).
const tokenFailure = vi.hoisted(() => ({ next: false }));
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>();
  return {
    ...actual,
    createToken: (async (...args: Parameters<typeof actual.createToken>) => {
      if (tokenFailure.next) {
        tokenFailure.next = false;
        throw new Error('Token-Fehler (Test)');
      }
      return actual.createToken(...args);
    }) as typeof actual.createToken,
  };
});

import { prisma } from '@/lib/db/prisma';
import { ForbiddenError } from '@/lib/auth/permissions';
import { sessionUserFixture } from '@/lib/mcp/tools/test-support';
import type { UserInput } from '@/lib/validation/user.schema';
import { createUserCore } from './create-user';

const RUN = `cu-core-${Date.now()}`;
let orgA: { id: string };
let orgB: { id: string };
let group: { id: string; organizationId: string };
let actorWrite: string;
let actorNone: string;

const email = (key: string) => `${RUN}-${key}@example.local`;

function input(key: string, overrides: Partial<UserInput> = {}): UserInput {
  return {
    firstName: 'Neu',
    lastName: RUN,
    email: email(key),
    stbNr: '4711',
    phone: '',
    isActive: false,
    istAtemschutzgeraeteTraeger: false,
    dienstgradId: '',
    homeOrganizationId: orgA.id,
    secondaryOrganizationId: '',
    secondaryDienstgradId: '',
    adminOrgIds: [],
    droneRole: 'NONE',
    droneGroupId: null,
    a1a3LizenzAm: '',
    a2LizenzAm: '',
    stuetzpunktausbildungAm: '',
    bos1AusbildungAm: '',
    bos2AusbildungAm: '',
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    sendWelcomeEmail: true,
    ...overrides,
  };
}

const bezirksAdmin = () => sessionUserFixture({ id: 'bezirks', isBezirksAdmin: true });
const feuerwehrAdmin = (id = actorWrite) => sessionUserFixture({ id, homeOrganizationId: orgA.id, feuerwehrAdminOrgIds: [orgA.id] });
const created = (key: string) => prisma.user.findUnique({ where: { email: email(key) } });

beforeAll(async () => {
  const orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 2 });
  if (orgs.length < 2) throw new Error('Seed fehlt: npm run db:seed');
  [orgA, orgB] = orgs;
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true } });
  actorWrite = (
    await prisma.user.create({ data: { email: email('actor-write'), passwordHash: 'x', firstName: 'A', lastName: RUN, homeOrganizationId: orgA.id, mcpAccess: 'WRITE' } })
  ).id;
  actorNone = (
    await prisma.user.create({ data: { email: email('actor-none'), passwordHash: 'x', firstName: 'B', lastName: RUN, homeOrganizationId: orgA.id, mcpAccess: 'NONE' } })
  ).id;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.passwordToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe('createUserCore', () => {
  it('legt einen inaktiven Benutzer mit Platzhalter-Passwort und Aktivierungstoken an', async () => {
    const result = await createUserCore(bezirksAdmin(), input('basis', { email: email('Basis').toUpperCase() }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await created('basis');
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
    expect(row!.email).toBe(email('basis'));
    expect(row!.passwordHash.length).toBeGreaterThan(20);
    expect(row!.mcpAccess).toBe('NONE');
    const tokens = await prisma.passwordToken.findMany({ where: { userId: row!.id, purpose: 'ACTIVATION' } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).not.toBe(result.activationToken);
    expect(result.user.id).toBe(row!.id);
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs ab und legt nichts an', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('fremd', { homeOrganizationId: orgB.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('fremd')).toBeNull();
  });

  it('lehnt "Admin für" außerhalb des Verwaltungsbereichs ab und legt nichts an', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('adminfremd', { adminOrgIds: [orgB.id] }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('adminfremd')).toBeNull();
  });

  it('lässt Bezirksadmin- und Bezirks-Drohnenadmin-Rechte nur einen Bezirksadmin vergeben', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('ba', { isBezirksAdmin: true }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createUserCore(feuerwehrAdmin(), input('bda', { isBezirksDrohnenAdmin: true, droneRole: 'ADMIN', droneGroupId: group.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('ba')).toBeNull();
    expect(await created('bda')).toBeNull();
  });

  it('legt Admin-Mitgliedschaft, Drohnengruppen-Mitgliedschaft und Ausbildung an', async () => {
    const result = await createUserCore(
      bezirksAdmin(),
      input('voll', { adminOrgIds: [orgA.id], droneRole: 'PILOT', droneGroupId: group.id, a1a3LizenzAm: '2025-01-10', a2LizenzAm: '2025-02-10' }),
    );
    expect(result.ok).toBe(true);
    const row = await created('voll');
    const memberships = await prisma.membership.findMany({ where: { userId: row!.id } });
    expect(memberships.map((m) => m.organizationId)).toEqual([orgA.id]);
    const drone = await prisma.drohnengruppeMembership.findUnique({ where: { userId: row!.id } });
    expect(drone).toMatchObject({ droneGroupId: group.id, role: 'PILOT' });
    expect(drone!.a1a3LizenzAm?.toISOString().slice(0, 10)).toBe('2025-01-10');
    expect(drone!.bos1AusbildungAm).toBeNull();
  });

  it('prüft das Drohnengruppen-Recht VOR dem Anlegen (kein Benutzer ohne Mitgliedschaft)', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('gruppe', { droneRole: 'PILOT', droneGroupId: group.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('gruppe')).toBeNull();
  });

  it('meldet eine bereits vergebene E-Mail-Adresse (ohne Groß-/Kleinschreibung) als Fehler', async () => {
    expect((await createUserCore(bezirksAdmin(), input('dupe'))).ok).toBe(true);
    const result = await createUserCore(bezirksAdmin(), input('dupe2', { email: email('DUPE') }));
    expect(result).toEqual({ ok: false, error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' });
  });

  it('vergibt MCP-Rechte nur mit Obergrenze: Admin ohne eigene Stufe nicht, mit WRITE ja, Bezirksadmin immer', async () => {
    await expect(createUserCore(feuerwehrAdmin(actorNone), input('mcp-none', { mcpAccess: 'READ' }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('mcp-none')).toBeNull();

    expect((await createUserCore(feuerwehrAdmin(actorWrite), input('mcp-read', { mcpAccess: 'READ' }))).ok).toBe(true);
    expect((await created('mcp-read'))!.mcpAccess).toBe('READ');

    expect((await createUserCore(bezirksAdmin(), input('mcp-write', { mcpAccess: 'WRITE' }))).ok).toBe(true);
    expect((await created('mcp-write'))!.mcpAccess).toBe('WRITE');
  });

  it('legt bei unbekannter Feuerwehr unter "Admin für" nichts an (Rollback statt halb angelegtem Benutzer)', async () => {
    await expect(createUserCore(bezirksAdmin(), input('adminorphan', { adminOrgIds: ['gibt-es-nicht'] }))).rejects.toThrow();
    expect(await created('adminorphan')).toBeNull();
    // Ein Wiederholungsversuch darf nicht an einer Karteileiche scheitern.
    expect((await createUserCore(bezirksAdmin(), input('adminorphan'))).ok).toBe(true);
  });

  it('rollt auch bereits geschriebene Mitgliedschaften zurück, wenn ein späterer Schritt fehlschlägt', async () => {
    await expect(
      createUserCore(bezirksAdmin(), input('teilweise', { adminOrgIds: [orgA.id, 'gibt-es-nicht'], droneRole: 'PILOT', droneGroupId: group.id })),
    ).rejects.toThrow();
    expect(await created('teilweise')).toBeNull();
  });

  it('rollt Benutzer und Mitgliedschaften zurück, wenn das Anlegen des Aktivierungstokens (letzter Schritt) fehlschlägt', async () => {
    tokenFailure.next = true;
    await expect(
      createUserCore(bezirksAdmin(), input('tokenfehler', { adminOrgIds: [orgA.id], droneRole: 'PILOT', droneGroupId: group.id })),
    ).rejects.toThrow('Token-Fehler (Test)');
    expect(tokenFailure.next).toBe(false);
    expect(await created('tokenfehler')).toBeNull();
    expect(await prisma.membership.count({ where: { user: { email: email('tokenfehler') } } })).toBe(0);
  });
});
