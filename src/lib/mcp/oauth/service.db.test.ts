import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { OauthError } from './errors';
import { createAuthorizationCode, registerClient, validateAuthorizeRequest } from './service';

const RUN = `oauth-${Date.now()}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(50);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

let org: { id: string };
const userIds: Record<string, string> = {};
let client: { clientId: string };

async function makeUser(key: string, mcpAccess: 'NONE' | 'READ' | 'WRITE', isActive = true) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: org.id, mcpAccess, isActive },
  });
  userIds[key] = user.id;
}

beforeAll(async () => {
  org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  await makeUser('none', 'NONE');
  await makeUser('read', 'READ');
  await makeUser('write', 'WRITE');
  await makeUser('inactive', 'WRITE', false);
  client = await registerClient({ clientName: `${RUN}-client`, redirectUris: [REDIRECT] });
});

afterAll(async () => {
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  await prisma.$disconnect();
});

describe('registerClient', () => {
  it('legt einen Client mit erlaubten Rücksprungadressen an', async () => {
    const created = await registerClient({ clientName: `${RUN}-b`, redirectUris: [REDIRECT, 'http://localhost:6274/cb'] });
    expect(created.clientId).toMatch(/^mcp_/);
    expect(created.redirectUris).toEqual([REDIRECT, 'http://localhost:6274/cb']);
  });

  it('lehnt fremde Rücksprungadressen ab', async () => {
    await expect(registerClient({ clientName: `${RUN}-c`, redirectUris: ['https://evil.example/cb'] })).rejects.toMatchObject({
      code: 'invalid_redirect_uri',
    });
  });

  it('lehnt fehlenden Namen und leere Adressliste ab', async () => {
    await expect(registerClient({ clientName: '', redirectUris: [REDIRECT] })).rejects.toBeInstanceOf(OauthError);
    await expect(registerClient({ clientName: `${RUN}-d`, redirectUris: [] })).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(registerClient({ clientName: `${RUN}-e`, redirectUris: 'https://claude.ai/cb' })).rejects.toBeInstanceOf(OauthError);
  });
});

describe('validateAuthorizeRequest', () => {
  const valid = () => ({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp:read',
    state: 'abc',
  });

  it('akzeptiert eine gültige Anfrage', async () => {
    const result = await validateAuthorizeRequest(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.clientName).toBe(`${RUN}-client`);
      expect(result.request.state).toBe('abc');
    }
  });

  it('meldet unbekannten Client und nicht registrierte Rücksprungadresse als fatal (kein Redirect)', async () => {
    expect(await validateAuthorizeRequest({ ...valid(), client_id: 'mcp_gibtsnicht' })).toMatchObject({ ok: false, fatal: true });
    expect(await validateAuthorizeRequest({ ...valid(), redirect_uri: 'https://claude.ai/anderer-pfad' })).toMatchObject({
      ok: false,
      fatal: true,
    });
  });

  it('meldet andere Fehler als Weiterleitung mit error und state', async () => {
    expect(await validateAuthorizeRequest({ ...valid(), response_type: 'token' })).toMatchObject({
      ok: false,
      fatal: false,
      error: 'unsupported_response_type',
      state: 'abc',
    });
    expect(await validateAuthorizeRequest({ ...valid(), code_challenge: undefined })).toMatchObject({ ok: false, fatal: false, error: 'invalid_request' });
    expect(await validateAuthorizeRequest({ ...valid(), code_challenge_method: 'plain' })).toMatchObject({
      ok: false,
      fatal: false,
      error: 'invalid_request',
    });
  });
});

describe('createAuthorizationCode', () => {
  async function request(scope = '') {
    const result = await validateAuthorizeRequest({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope,
    });
    if (!result.ok) throw new Error('Testanfrage ungültig');
    return result.request;
  }

  it('speichert nur den Hash, 60 Sekunden gültig, mit zugeschnittenem Umfang', async () => {
    const { code } = await createAuthorizationCode({ userId: userIds.read, request: await request() });
    const row = await prisma.oauthAuthorizationCode.findFirstOrThrow({ where: { userId: userIds.read }, orderBy: { createdAt: 'desc' } });
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).toHaveLength(64);
    expect(row.scope).toBe('mcp:read');
    expect(row.usedAt).toBeNull();
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(61_000);
  });

  it('WRITE-Benutzer bekommt ohne Anfrage beide Scopes', async () => {
    await createAuthorizationCode({ userId: userIds.write, request: await request() });
    const row = await prisma.oauthAuthorizationCode.findFirstOrThrow({ where: { userId: userIds.write }, orderBy: { createdAt: 'desc' } });
    expect(row.scope).toBe('mcp:read mcp:write');
  });

  it('lehnt Benutzer ohne MCP-Zugriff, deaktivierte und unbekannte Benutzer ab', async () => {
    await expect(createAuthorizationCode({ userId: userIds.none, request: await request() })).rejects.toMatchObject({ code: 'access_denied' });
    await expect(createAuthorizationCode({ userId: userIds.inactive, request: await request() })).rejects.toMatchObject({ code: 'access_denied' });
    await expect(createAuthorizationCode({ userId: 'gibt-es-nicht', request: await request() })).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('lehnt einen Umfang ab, den die eigene Stufe nicht hergibt', async () => {
    await expect(createAuthorizationCode({ userId: userIds.read, request: await request('mcp:write') })).rejects.toMatchObject({ code: 'invalid_scope' });
  });
});
