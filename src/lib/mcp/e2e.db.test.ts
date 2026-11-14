import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/mcp/route';
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled, setMcpEnabled } from '@/lib/mcp/enabled';
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
  revokeToken,
  validateAuthorizeRequest,
} from '@/lib/mcp/oauth/service';

/**
 * Ende-zu-Ende über den echten Code (keine Mocks): Registrierung → Zustimmung (Code, PKCE) → Token → /api/mcp →
 * Refresh-Rotation → Rechteentzug → Widerruf. So verhält sich ein echter Client wie Claude oder der MCP Inspector.
 */

const RUN = `mcp-e2e-${Date.now()}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = `${RUN}-verifier-`.padEnd(64, 'x');
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');

let userId: string | undefined;
let wasEnabled: boolean | undefined;

function rpc(method: string, params: unknown, token?: string) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

beforeAll(async () => {
  wasEnabled = await isMcpEnabled();
  await setMcpEnabled(true);
  process.env.AUTH_URL = 'https://app-17.example.test';
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'E2E', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'READ' },
  });
  userId = user.id;
});

afterAll(async () => {
  try {
    if (userId) {
      await prisma.oauthToken.deleteMany({ where: { userId } });
      await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
      await prisma.mcpAuditLog.deleteMany({ where: { userId } });
    }
    await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  } finally {
    if (wasEnabled !== undefined) await setMcpEnabled(wasEnabled);
    await prisma.$disconnect();
  }
});

describe('MCP-Connector Ende-zu-Ende', () => {
  it('Registrierung, Anmeldung, Abfragen, Refresh-Rotation, Rechteentzug und Widerruf', async () => {
    // 1. Der Client registriert sich selbst (Dynamic Client Registration).
    const client = await registerClient({ clientName: `${RUN}-client`, redirectUris: [REDIRECT] });
    expect(client.clientId).toMatch(/^mcp_/);

    // 2. Zustimmungsseite: Anfrage prüfen, nach "Erlauben" Code ausstellen.
    const validated = await validateAuthorizeRequest({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'mcp:read',
      state: 'xyz',
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const { code } = await createAuthorizationCode({ userId: userId!, request: validated.request });

    // 3. Token-Endpunkt: falscher Verifier scheitert und verbrennt den Code nicht, der richtige tauscht ihn ein.
    await expect(
      exchangeAuthorizationCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    const first = await exchangeAuthorizationCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(first.token_type).toBe('Bearer');
    expect(first.scope).toBe('mcp:read');
    // Der Code ist einmalig.
    await expect(
      exchangeAuthorizationCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });

    // 4. /api/mcp mit dem Zugriffstoken: tools/list und tools/call.
    const list = await POST(rpc('tools/list', {}, first.access_token));
    expect(list.status).toBe(200);
    const listBody = await list.json();
    const names: string[] = listBody.result.tools.map((t: { name: string }) => t.name);
    expect(names).toHaveLength(12);
    expect(names).toContain('list_dienstgrade');

    const call = await POST(rpc('tools/call', { name: 'list_dienstgrade', arguments: {} }, first.access_token));
    expect(call.status).toBe(200);
    const callBody = await call.json();
    expect(callBody.result.isError).toBeFalsy();
    expect(JSON.parse(callBody.result.content[0].text).items.length).toBeGreaterThan(10);

    // 5. Refresh mit Rotation: neuer Satz; der alte Satz (Access und Refresh) gehört zur selben, nun widerrufenen Zeile.
    const second = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await POST(rpc('tools/list', {}, second.access_token))).status).toBe(200);
    expect((await POST(rpc('tools/list', {}, first.access_token))).status).toBe(401);

    // 6. Wiederverwendung des alten Refresh-Tokens gilt als Diebstahl: ganze Kette widerrufen, auch der neue Zugriff.
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect((await POST(rpc('tools/list', {}, second.access_token))).status).toBe(401);
    await expect(refreshAccessToken({ refreshToken: second.refresh_token, clientId: client.clientId })).rejects.toMatchObject({
      code: 'invalid_grant',
    });

    // 7. Neue Anmeldung; Entzug von mcpAccess wirkt sofort (403) trotz noch gültigem Token.
    const again = await createAuthorizationCode({ userId: userId!, request: validated.request });
    const third = await exchangeAuthorizationCode({ code: again.code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect((await POST(rpc('tools/list', {}, third.access_token))).status).toBe(200);

    await prisma.user.update({ where: { id: userId! }, data: { mcpAccess: 'NONE' } });
    const denied = await POST(rpc('tools/list', {}, third.access_token));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'insufficient_scope' });

    // Mit wiederhergestelltem Zugriff funktioniert dasselbe Token wieder; dann Widerruf (RFC 7009) -> 401.
    await prisma.user.update({ where: { id: userId! }, data: { mcpAccess: 'READ' } });
    expect((await POST(rpc('tools/list', {}, third.access_token))).status).toBe(200);
    await revokeToken({ token: third.access_token, clientId: client.clientId });
    expect((await POST(rpc('tools/list', {}, third.access_token))).status).toBe(401);
  });
});
