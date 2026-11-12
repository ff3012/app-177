import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { hashSecret } from './oauth/secrets';
import { MCP_AUDIT_RETENTION_DAYS, purgeMcpData } from './retention';

const RUN = `mcp-ret-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let userId: string | undefined;
let clientRowId: string | undefined;

const token = (key: string, data: { revokedAt?: Date | null; refreshExpiresAt: Date }) =>
  prisma.oauthToken.create({
    data: {
      accessTokenHash: hashSecret(`${RUN}-a-${key}`),
      refreshTokenHash: hashSecret(`${RUN}-r-${key}`),
      oauthClientId: clientRowId!,
      userId: userId!,
      scope: 'mcp:read',
      expiresAt: new Date(Date.now() + DAY),
      refreshExpiresAt: data.refreshExpiresAt,
      revokedAt: data.revokedAt ?? null,
    },
  });

beforeAll(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  userId = (await prisma.user.create({ data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'R', lastName: RUN, homeOrganizationId: org.id } })).id;
  clientRowId = (await prisma.oauthClient.create({ data: { clientId: `mcp_${RUN}`, name: `${RUN}-client`, redirectUris: ['https://claude.ai/cb'] } })).id;
});

afterAll(async () => {
  // Ohne userId/clientRowId (beforeAll fehlgeschlagen) würde Prisma `undefined` als "kein Filter" lesen und ALLES löschen.
  if (userId) {
    await prisma.oauthToken.deleteMany({ where: { userId } });
    await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  }
  await prisma.mcpAuditLog.deleteMany({ where: { clientId: RUN } });
  await prisma.oauthClient.deleteMany({ where: { OR: [{ name: { startsWith: RUN } }, { clientId: { startsWith: `mcp_${RUN}` } }] } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('purgeMcpData', () => {
  it('nennt eine Aufbewahrung von 180 Tagen für das Prüfprotokoll', () => {
    expect(MCP_AUDIT_RETENTION_DAYS).toBe(180);
  });

  it('löscht Prüfprotokoll-Einträge älter als 180 Tage, behält jüngere', async () => {
    const base = { userId: userId!, clientId: RUN, tool: 'x', outcome: 'OK' as const };
    await prisma.mcpAuditLog.create({ data: { ...base, summary: 'alt', createdAt: new Date(Date.now() - 181 * DAY) } });
    await prisma.mcpAuditLog.create({ data: { ...base, summary: 'jung', createdAt: new Date(Date.now() - 179 * DAY) } });
    const result = await purgeMcpData();
    expect(result.audit).toBeGreaterThanOrEqual(1);
    const left = await prisma.mcpAuditLog.findMany({ where: { clientId: RUN } });
    expect(left.map((e) => e.summary)).toEqual(['jung']);
  });

  it('löscht Token 30 Tage nach Widerruf oder Ablauf, behält gültige und frisch widerrufene', async () => {
    await token('lange-widerrufen', { refreshExpiresAt: new Date(Date.now() + 10 * DAY), revokedAt: new Date(Date.now() - 31 * DAY) });
    await token('lange-abgelaufen', { refreshExpiresAt: new Date(Date.now() - 31 * DAY) });
    await token('frisch-widerrufen', { refreshExpiresAt: new Date(Date.now() + 10 * DAY), revokedAt: new Date(Date.now() - 1 * DAY) });
    await token('frisch-abgelaufen', { refreshExpiresAt: new Date(Date.now() - 1 * DAY) });
    await token('gueltig', { refreshExpiresAt: new Date(Date.now() + 10 * DAY) });
    const result = await purgeMcpData();
    expect(result.tokens).toBeGreaterThanOrEqual(2);
    const left = await prisma.oauthToken.findMany({ where: { userId: userId! } });
    expect(left.map((t) => t.accessTokenHash).sort()).toEqual(
      [hashSecret(`${RUN}-a-frisch-widerrufen`), hashSecret(`${RUN}-a-frisch-abgelaufen`), hashSecret(`${RUN}-a-gueltig`)].sort(),
    );
  });

  it('löscht Autorisierungscodes einen Tag nach Ablauf (auch eingelöste), behält frische', async () => {
    const base = { oauthClientId: clientRowId!, userId: userId!, redirectUri: 'https://claude.ai/cb', codeChallenge: 'c'.repeat(43), scope: 'mcp:read' };
    await prisma.oauthAuthorizationCode.create({ data: { ...base, codeHash: hashSecret(`${RUN}-c-alt`), expiresAt: new Date(Date.now() - 2 * DAY) } });
    await prisma.oauthAuthorizationCode.create({
      data: { ...base, codeHash: hashSecret(`${RUN}-c-alt-eingeloest`), expiresAt: new Date(Date.now() - 2 * DAY), usedAt: new Date(Date.now() - 2 * DAY) },
    });
    await prisma.oauthAuthorizationCode.create({ data: { ...base, codeHash: hashSecret(`${RUN}-c-neu`), expiresAt: new Date(Date.now() - 60 * 1000) } });
    await prisma.oauthAuthorizationCode.create({ data: { ...base, codeHash: hashSecret(`${RUN}-c-gueltig`), expiresAt: new Date(Date.now() + 60 * 1000) } });
    const result = await purgeMcpData();
    expect(result.codes).toBeGreaterThanOrEqual(2);
    const left = await prisma.oauthAuthorizationCode.findMany({ where: { userId: userId! } });
    expect(left.map((c) => c.codeHash).sort()).toEqual([hashSecret(`${RUN}-c-neu`), hashSecret(`${RUN}-c-gueltig`)].sort());
  });

  it('löscht verwaiste Clients (älter als 30 Tage, ohne Token und Codes), behält Clients mit Token oder jüngere', async () => {
    const old = new Date(Date.now() - 31 * DAY);
    const orphan = await prisma.oauthClient.create({ data: { clientId: `mcp_${RUN}_orphan`, name: `${RUN}-orphan`, redirectUris: ['https://claude.ai/cb'], createdAt: old } });
    await prisma.oauthClient.create({ data: { clientId: `mcp_${RUN}_young`, name: `${RUN}-young`, redirectUris: ['https://claude.ai/cb'] } });
    // Alter Client, der nur noch einen (frischen) Code hat: belegt, bleibt.
    const withCode = await prisma.oauthClient.create({ data: { clientId: `mcp_${RUN}_code`, name: `${RUN}-code`, redirectUris: ['https://claude.ai/cb'], createdAt: old } });
    await prisma.oauthAuthorizationCode.create({
      data: {
        oauthClientId: withCode.id,
        userId: userId!,
        redirectUri: 'https://claude.ai/cb',
        codeChallenge: 'c'.repeat(43),
        scope: 'mcp:read',
        codeHash: hashSecret(`${RUN}-c-client-code`),
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });
    // Der Client aus beforeAll hat gültige Token (Test oben) und ist ebenfalls alt - er darf NICHT gelöscht werden.
    await prisma.oauthClient.update({ where: { id: clientRowId! }, data: { createdAt: old } });
    const result = await purgeMcpData();
    expect(result.clients).toBeGreaterThanOrEqual(1);
    expect(await prisma.oauthClient.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(await prisma.oauthClient.findUnique({ where: { clientId: `mcp_${RUN}_young` } })).not.toBeNull();
    expect(await prisma.oauthClient.findUnique({ where: { id: withCode.id } })).not.toBeNull();
    expect(await prisma.oauthClient.findUnique({ where: { id: clientRowId! } })).not.toBeNull();
  });

  it('räumt einen Client auf, dessen letzte Token im selben Lauf gelöscht werden', async () => {
    const old = new Date(Date.now() - 40 * DAY);
    const client = await prisma.oauthClient.create({ data: { clientId: `mcp_${RUN}_chain`, name: `${RUN}-chain`, redirectUris: ['https://claude.ai/cb'], createdAt: old } });
    await prisma.oauthToken.create({
      data: {
        accessTokenHash: hashSecret(`${RUN}-a-chain`),
        refreshTokenHash: hashSecret(`${RUN}-r-chain`),
        oauthClientId: client.id,
        userId: userId!,
        scope: 'mcp:read',
        expiresAt: new Date(Date.now() - 40 * DAY),
        refreshExpiresAt: new Date(Date.now() - 35 * DAY),
        revokedAt: new Date(Date.now() - 40 * DAY),
      },
    });
    const result = await purgeMcpData();
    expect(result.tokens).toBeGreaterThanOrEqual(1);
    expect(result.clients).toBeGreaterThanOrEqual(1);
    expect(await prisma.oauthClient.findUnique({ where: { id: client.id } })).toBeNull();
  });
});
