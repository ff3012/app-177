import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { ForbiddenError } from '@/lib/auth/permissions';
import { getKiAppsVisibility, listConnections, revokeAllConnectionsAs, revokeConnection } from './connections';
import { isMcpEnabled, setMcpEnabled } from './enabled';
import { issueTestToken } from './test-support-db';
import { sessionUserFixture } from './tools/test-support';

const RUN = `mcp-conn-${Date.now()}`;
let userId: string | undefined;
let otherUserId: string | undefined;
let wasEnabled: boolean | undefined;

beforeAll(async () => {
  wasEnabled = await isMcpEnabled();
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  userId = (await prisma.user.create({ data: { email: `${RUN}-a@example.local`, passwordHash: 'x', firstName: 'A', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'READ' } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `${RUN}-b@example.local`, passwordHash: 'x', firstName: 'B', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'NONE' } })).id;
});

afterAll(async () => {
  try {
    if (wasEnabled !== undefined) await setMcpEnabled(wasEnabled);
    const ids = [userId, otherUserId].filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) {
      await prisma.oauthToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.oauthAuthorizationCode.deleteMany({ where: { userId: { in: ids } } });
    }
    await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
    if (ids.length > 0) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('listConnections / revokeConnection', () => {
  it('führt je Client genau eine Verbindung und blendet widerrufene und abgelaufene aus', async () => {
    await issueTestToken({ userId: userId!, namePrefix: `${RUN}-claude` });
    await issueTestToken({ userId: userId!, namePrefix: `${RUN}-chatgpt` });
    await issueTestToken({ userId: userId!, namePrefix: `${RUN}-alt` });
    await prisma.oauthToken.updateMany({ where: { oauthClient: { name: `${RUN}-alt-client` } }, data: { refreshExpiresAt: new Date(Date.now() - 1000) } });

    const connections = await listConnections(userId!);
    expect(connections.map((c) => c.clientName).sort()).toEqual([`${RUN}-chatgpt-client`, `${RUN}-claude-client`]);
    expect(connections[0].connectedAt).toBeInstanceOf(Date);
  });

  it('revokeConnection beendet nur die Verbindung dieses Clients des eigenen Benutzers', async () => {
    const connections = await listConnections(userId!);
    const victim = connections.find((c) => c.clientName === `${RUN}-claude-client`)!;

    // Ein anderer Benutzer kann diese Verbindung nicht beenden.
    expect(await revokeConnection(otherUserId!, victim.oauthClientId)).toBe(0);
    expect(await listConnections(userId!)).toHaveLength(2);

    expect(await revokeConnection(userId!, victim.oauthClientId)).toBe(1);
    const after = await listConnections(userId!);
    expect(after.map((c) => c.clientName)).toEqual([`${RUN}-chatgpt-client`]);
  });

  it('eine erratene oder unbekannte Client-ID widerruft nichts und beendet nie Token anderer Benutzer desselben Clients', async () => {
    const [mine] = await listConnections(userId!);
    // Fremder Token am selben Client (direkt angelegt; otherUser hat keinen MCP-Zugriff, daher kein regulärer Ablauf).
    await prisma.oauthToken.create({
      data: {
        accessTokenHash: `${RUN}-acc`,
        refreshTokenHash: `${RUN}-ref`,
        oauthClientId: mine.oauthClientId,
        userId: otherUserId!,
        scope: 'mcp:read',
        expiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await revokeConnection(userId!, 'gibt-es-nicht')).toBe(0);
    // Leere oder keine Zeichenkette darf nie als "kein Filter" gelesen werden (würde alle Token des Benutzers widerrufen).
    expect(await revokeConnection(userId!, '')).toBe(0);
    expect(await revokeConnection(userId!, undefined as unknown as string)).toBe(0);
    expect(await revokeConnection(userId!, { not: 'a string' } as unknown as string)).toBe(0);
    expect(await listConnections(userId!)).toHaveLength(1);
    expect(await revokeConnection(userId!, mine.oauthClientId)).toBe(1);
    expect(await listConnections(userId!)).toHaveLength(0);
    // Der Token des anderen Benutzers am selben Client bleibt unberührt.
    expect(await listConnections(otherUserId!)).toHaveLength(1);
  });
});

describe('getKiAppsVisibility', () => {
  it('zeigt den Eintrag nur bei eingeschaltetem Schalter und vorhandenem MCP-Recht', async () => {
    await setMcpEnabled(true);
    expect(await getKiAppsVisibility(userId!)).toBe(true);
    expect(await getKiAppsVisibility(otherUserId!)).toBe(false);
    expect(await getKiAppsVisibility('gibt-es-nicht')).toBe(false);
    await setMcpEnabled(false);
    expect(await getKiAppsVisibility(userId!)).toBe(false);
  });
});

describe('revokeAllConnectionsAs (Admin sperrt alle Verbindungen eines Benutzers)', () => {
  let orgId: string;
  let otherOrgId: string;
  let targetId: string | undefined;
  let bezirksadminTargetId: string | undefined;
  let bystanderId: string | undefined;
  // Der Akteur des Prüfprotokolls muss ein echter Benutzer sein (userId ist ein Fremdschlüssel).
  let actorId: string | undefined;

  async function giveTokens(forUserId: string, tag: string): Promise<void> {
    await issueTestToken({ userId: forUserId, namePrefix: `${RUN}-${tag}-1` });
    await issueTestToken({ userId: forUserId, namePrefix: `${RUN}-${tag}-2` });
  }

  beforeAll(async () => {
    const orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR' }, take: 2, orderBy: { id: 'asc' } });
    orgId = orgs[0].id;
    otherOrgId = orgs[1].id;
    targetId = (await prisma.user.create({ data: { email: `${RUN}-t@example.local`, passwordHash: 'x', firstName: 'T', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'READ' } })).id;
    bystanderId = (await prisma.user.create({ data: { email: `${RUN}-by@example.local`, passwordHash: 'x', firstName: 'BY', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'READ' } })).id;
    actorId = (await prisma.user.create({ data: { email: `${RUN}-act@example.local`, passwordHash: 'x', firstName: 'ACT', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'NONE' } })).id;
    bezirksadminTargetId = (await prisma.user.create({ data: { email: `${RUN}-ba@example.local`, passwordHash: 'x', firstName: 'BA', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'READ', isBezirksAdmin: true } })).id;
  });

  afterAll(async () => {
    // Prüfprotokoll-Zeilen dieses Blocks (über die Testbenutzer als Ziel; der Akteur-Fremdschlüssel steht auf SetNull).
    await prisma.mcpAuditLog.deleteMany({
      where: { tool: 'admin_revoke', targetUserId: { in: [targetId, bezirksadminTargetId, bystanderId].filter((id): id is string => typeof id === 'string') } },
    });
    const ids = [targetId, bezirksadminTargetId, bystanderId, actorId].filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) {
      await prisma.oauthToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.oauthAuthorizationCode.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('Admin der Heimatfeuerwehr sperrt ausdrücklich ALLE Verbindungen (alle Clients) des Benutzers, andere Benutzer bleiben unberührt', async () => {
    await giveTokens(targetId!, 'in');
    await giveTokens(bystanderId!, 'bystander');
    expect(await listConnections(targetId!)).toHaveLength(2);

    const admin = sessionUserFixture({ id: actorId!, homeOrganizationId: orgId, feuerwehrAdminOrgIds: [orgId] });
    const result = await revokeAllConnectionsAs(admin, targetId!);
    expect(result).toEqual({ revoked: 2 });
    const auditRows = await prisma.mcpAuditLog.findMany({ where: { tool: 'admin_revoke', targetUserId: targetId! } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ userId: actorId, outcome: 'OK', clientId: null, summary: 'Admin hat 2 Token gesperrt' });
    expect(await listConnections(targetId!)).toHaveLength(0);
    expect(await listConnections(bystanderId!)).toHaveLength(2);
    // Zweiter Aufruf: nichts mehr zu sperren, kein Fehler.
    expect(await revokeAllConnectionsAs(admin, targetId!)).toEqual({ revoked: 0 });
  });

  it('Admin einer anderen Feuerwehr wird abgelehnt und ändert nichts', async () => {
    await giveTokens(targetId!, 'out');
    const outsider = sessionUserFixture({ id: actorId!, homeOrganizationId: otherOrgId, feuerwehrAdminOrgIds: [otherOrgId] });
    const auditBefore = await prisma.mcpAuditLog.count({ where: { tool: 'admin_revoke' } });
    await expect(revokeAllConnectionsAs(outsider, targetId!)).rejects.toBeInstanceOf(ForbiddenError);
    // Eine Verweigerung wird (anders als ein Erfolg) nicht protokolliert.
    expect(await prisma.mcpAuditLog.count({ where: { tool: 'admin_revoke' } })).toBe(auditBefore);
    expect(await listConnections(targetId!)).toHaveLength(2);
  });

  it('ein gewöhnliches Mitglied (auch der Benutzer selbst über diesen Admin-Weg) wird abgelehnt', async () => {
    const member = sessionUserFixture({ id: targetId!, homeOrganizationId: orgId });
    await expect(revokeAllConnectionsAs(member, targetId!)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listConnections(targetId!)).toHaveLength(2);
  });

  it('ein Feuerwehr-Admin darf die Verbindungen eines Bezirksadmins nicht sperren, ein Bezirksadmin schon', async () => {
    await giveTokens(bezirksadminTargetId!, 'ba');
    const feuerwehrAdmin = sessionUserFixture({ id: 'admin-fw', homeOrganizationId: orgId, feuerwehrAdminOrgIds: [orgId] });
    await expect(revokeAllConnectionsAs(feuerwehrAdmin, bezirksadminTargetId!)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listConnections(bezirksadminTargetId!)).toHaveLength(2);

    const bezirksadmin = sessionUserFixture({ id: 'admin-bz', isBezirksAdmin: true });
    expect(await revokeAllConnectionsAs(bezirksadmin, bezirksadminTargetId!)).toEqual({ revoked: 2 });
    // Der Bezirksadmin darf auch Benutzer jeder anderen Feuerwehr sperren.
    expect(await revokeAllConnectionsAs(bezirksadmin, targetId!)).toEqual({ revoked: 2 });
  });

  it('unbekannte oder leere Benutzer-ID liefert einen Fehler und sperrt nichts', async () => {
    const bezirksadmin = sessionUserFixture({ id: 'admin-bz', isBezirksAdmin: true });
    await giveTokens(bystanderId!, 'guard');
    const before = await listConnections(bystanderId!);
    expect(await revokeAllConnectionsAs(bezirksadmin, 'gibt-es-nicht')).toEqual({ error: 'Benutzer wurde nicht gefunden.' });
    expect(await revokeAllConnectionsAs(bezirksadmin, '')).toEqual({ error: 'Benutzer wurde nicht gefunden.' });
    expect(await revokeAllConnectionsAs(bezirksadmin, undefined as unknown as string)).toEqual({ error: 'Benutzer wurde nicht gefunden.' });
    expect(await listConnections(bystanderId!)).toHaveLength(before.length);
  });
});
