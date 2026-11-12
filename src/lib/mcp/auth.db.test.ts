import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { authenticateBearer } from './auth';
import { hashSecret } from './oauth/secrets';
import { issueTestToken } from './test-support-db';

const RUN = `mcp-auth-${Date.now()}`;
let orgId: string;
let userId: string;

beforeAll(async () => {
  orgId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Auth', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'WRITE' },
  });
  userId = user.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.oauthToken.deleteMany({ where: { userId } });
    await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  }
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const bearer = (token: string) => `Bearer ${token}`;

describe('authenticateBearer', () => {
  it('liefert Benutzer, Stufe und Client für ein gültiges Token', async () => {
    const { accessToken } = await issueTestToken({ userId, namePrefix: `${RUN}-ok` });
    const result = await authenticateBearer(bearer(accessToken));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.user.id).toBe(userId);
      expect(result.principal.user.name).toBe(`Auth ${RUN}`);
      expect(result.principal.access).toBe('WRITE');
      expect(result.principal.clientName).toBe(`${RUN}-ok-client`);
    }
  });

  it('lehnt fehlenden, falsch geformten und unbekannten Header ab (401)', async () => {
    for (const header of [null, '', 'Basic abc', 'Bearer', 'Bearer   ', 'Bearer unbekannt']) {
      expect(await authenticateBearer(header)).toEqual({ ok: false, status: 401, error: 'invalid_token' });
    }
  });

  it('lehnt widerrufene und abgelaufene Token ab (401)', async () => {
    const revoked = await issueTestToken({ userId, namePrefix: `${RUN}-rev` });
    await prisma.oauthToken.updateMany({ where: { accessTokenHash: hashSecret(revoked.accessToken) }, data: { revokedAt: new Date() } });
    expect(await authenticateBearer(bearer(revoked.accessToken))).toMatchObject({ ok: false, status: 401 });

    const expired = await issueTestToken({ userId, namePrefix: `${RUN}-exp` });
    await prisma.oauthToken.updateMany({ where: { accessTokenHash: hashSecret(expired.accessToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await authenticateBearer(bearer(expired.accessToken))).toMatchObject({ ok: false, status: 401 });
  });

  it('schneidet die Stufe auf Token-Umfang und aktuelles mcpAccess zu', async () => {
    const readOnly = await issueTestToken({ userId, namePrefix: `${RUN}-ro`, scope: 'mcp:read' });
    const readResult = await authenticateBearer(bearer(readOnly.accessToken));
    expect(readResult.ok && readResult.principal.access).toBe('READ');

    const full = await issueTestToken({ userId, namePrefix: `${RUN}-full` });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'READ' } });
    const downgraded = await authenticateBearer(bearer(full.accessToken));
    expect(downgraded.ok && downgraded.principal.access).toBe('READ');
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE' } });
  });

  it('verweigert (403), wenn das Recht inzwischen entzogen wurde, und lehnt deaktivierte Benutzer ab (401)', async () => {
    const { accessToken } = await issueTestToken({ userId, namePrefix: `${RUN}-lost` });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'NONE' } });
    expect(await authenticateBearer(bearer(accessToken))).toEqual({ ok: false, status: 403, error: 'insufficient_scope' });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE', isActive: false } });
    expect(await authenticateBearer(bearer(accessToken))).toEqual({ ok: false, status: 401, error: 'invalid_token' });
    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});
