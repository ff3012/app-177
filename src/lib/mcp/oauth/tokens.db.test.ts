import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { hashSecret } from './secrets';
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
  revokeToken,
  revokeTokensOfUser,
  validateAuthorizeRequest,
} from './service';

const RUN = `oauth-tok-${Date.now()}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'p'.repeat(60);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

let orgId: string;
let userId: string;
let client: { clientId: string };
let otherClient: { clientId: string };

beforeAll(async () => {
  orgId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Tok', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'WRITE' },
  });
  userId = user.id;
  client = await registerClient({ clientName: `${RUN}-a`, redirectUris: [REDIRECT] });
  otherClient = await registerClient({ clientName: `${RUN}-b`, redirectUris: [REDIRECT] });
});

afterAll(async () => {
  await prisma.oauthToken.deleteMany({ where: { userId } });
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

async function newCode(scope = '', forClient = client.clientId): Promise<string> {
  const validated = await validateAuthorizeRequest({
    response_type: 'code',
    client_id: forClient,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope,
  });
  if (!validated.ok) throw new Error('Testanfrage ungültig');
  return (await createAuthorizationCode({ userId, request: validated.request })).code;
}

const exchangeInput = (code: string, overrides: Partial<{ clientId: string; redirectUri: string; codeVerifier: string }> = {}) => ({
  code,
  clientId: client.clientId,
  redirectUri: REDIRECT,
  codeVerifier: verifier,
  ...overrides,
});

describe('exchangeAuthorizationCode', () => {
  it('tauscht den Code gegen Token, speichert nur Hashes und markiert den Code als benutzt', async () => {
    const code = await newCode();
    const tokens = await exchangeAuthorizationCode(exchangeInput(code));
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe('mcp:read mcp:write');
    const row = await prisma.oauthToken.findUniqueOrThrow({ where: { accessTokenHash: hashSecret(tokens.access_token) } });
    expect(row.refreshTokenHash).toBe(hashSecret(tokens.refresh_token));
    expect(row.userId).toBe(userId);
    expect(row.revokedAt).toBeNull();
    const refreshTtl = row.refreshExpiresAt.getTime() - row.createdAt.getTime();
    expect(refreshTtl).toBeGreaterThan(29 * 24 * 3600 * 1000);
  });

  it('löst einen Code nur einmal ein', async () => {
    const code = await newCode();
    await exchangeAuthorizationCode(exchangeInput(code));
    await expect(exchangeAuthorizationCode(exchangeInput(code))).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('lehnt falschen Verifier, falsche Rücksprungadresse und fremden Client ab, ohne den Code zu verbrauchen', async () => {
    const code = await newCode();
    await expect(exchangeAuthorizationCode(exchangeInput(code, { codeVerifier: 'x'.repeat(60) }))).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchangeAuthorizationCode(exchangeInput(code, { redirectUri: 'https://claude.ai/anders' }))).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchangeAuthorizationCode(exchangeInput(code, { clientId: otherClient.clientId }))).rejects.toMatchObject({ code: 'invalid_grant' });
    // Der Code ist weiterhin einlösbar - Fehlversuche verbrennen ihn nicht (und erlauben kein Raten des Verifiers).
    await expect(exchangeAuthorizationCode(exchangeInput(code))).resolves.toHaveProperty('access_token');
  });

  it('lehnt einen abgelaufenen Code ab', async () => {
    const code = await newCode();
    await prisma.oauthAuthorizationCode.updateMany({ where: { codeHash: hashSecret(code) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(exchangeAuthorizationCode(exchangeInput(code))).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('lehnt ab, wenn der Benutzer inzwischen keinen Zugriff mehr hat', async () => {
    const code = await newCode();
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'NONE' } });
    await expect(exchangeAuthorizationCode(exchangeInput(code))).rejects.toMatchObject({ code: 'invalid_grant' });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE' } });
  });
});

describe('refreshAccessToken', () => {
  async function freshTokens() {
    return exchangeAuthorizationCode(exchangeInput(await newCode()));
  }

  it('rotiert: neuer Satz Token, alter Refresh-Token ist danach widerrufen', async () => {
    const first = await freshTokens();
    const second = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const old = await prisma.oauthToken.findUniqueOrThrow({ where: { refreshTokenHash: hashSecret(first.refresh_token) } });
    expect(old.revokedAt).not.toBeNull();
  });

  it('Wiederverwendung eines ersetzten Refresh-Tokens widerruft die ganze Kette', async () => {
    const first = await freshTokens();
    const second = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    const newest = await prisma.oauthToken.findUniqueOrThrow({ where: { accessTokenHash: hashSecret(second.access_token) } });
    expect(newest.revokedAt).not.toBeNull();
  });

  it('lehnt fremden Client, unbekannten und abgelaufenen Refresh-Token ab', async () => {
    const first = await freshTokens();
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: otherClient.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(refreshAccessToken({ refreshToken: 'unbekannt', clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    await prisma.oauthToken.updateMany({ where: { refreshTokenHash: hashSecret(first.refresh_token) }, data: { refreshExpiresAt: new Date(Date.now() - 1000) } });
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('schneidet den Umfang auf die aktuelle Stufe zu und verweigert bei NONE', async () => {
    const first = await freshTokens();
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'READ' } });
    const downgraded = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    expect(downgraded.scope).toBe('mcp:read');
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'NONE' } });
    await expect(refreshAccessToken({ refreshToken: downgraded.refresh_token, clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE' } });
  });
});

describe('revokeToken / revokeTokensOfUser', () => {
  it('widerruft per Access- oder Refresh-Token und ignoriert unbekannte Werte', async () => {
    const a = await exchangeAuthorizationCode(exchangeInput(await newCode()));
    const b = await exchangeAuthorizationCode(exchangeInput(await newCode()));
    await revokeToken({ token: a.access_token });
    await revokeToken({ token: b.refresh_token });
    await revokeToken({ token: 'unbekannt' });
    const rows = await prisma.oauthToken.findMany({ where: { accessTokenHash: { in: [hashSecret(a.access_token), hashSecret(b.access_token)] } } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('revokeTokensOfUser widerruft alle noch gültigen Token und nennt die Anzahl', async () => {
    await exchangeAuthorizationCode(exchangeInput(await newCode()));
    await exchangeAuthorizationCode(exchangeInput(await newCode()));
    const count = await revokeTokensOfUser(userId);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(await prisma.oauthToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
