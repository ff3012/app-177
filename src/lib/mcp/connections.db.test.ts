import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getKiAppsVisibility, listConnections, revokeConnection } from './connections';
import { isMcpEnabled, setMcpEnabled } from './enabled';
import { issueTestToken } from './test-support-db';

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
