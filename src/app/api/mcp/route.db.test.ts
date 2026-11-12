import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled, setMcpEnabled } from '@/lib/mcp/enabled';
import { issueTestToken } from '@/lib/mcp/test-support-db';
import { OPTIONS, POST } from './route';

const RUN = `mcp-route-${Date.now()}`;
let userId: string | undefined;
let wasEnabled: boolean | undefined;
let readToken: string;

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
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Route', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'READ' },
  });
  userId = user.id;
  readToken = (await issueTestToken({ userId, namePrefix: RUN })).accessToken;
});

afterAll(async () => {
  if (wasEnabled !== undefined) await setMcpEnabled(wasEnabled);
  if (userId) {
    await prisma.oauthToken.deleteMany({ where: { userId } });
    await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
    await prisma.mcpAuditLog.deleteMany({ where: { userId } });
  }
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('/api/mcp', () => {
  it('antwortet ohne Token mit 401 und verweist auf die Resource-Metadaten', async () => {
    const response = await POST(rpc('tools/list', {}));
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://app-17.example.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it('listet mit gültigem Token die Werkzeuge der Stufe (READ: keine Schreibwerkzeuge)', async () => {
    const response = await POST(rpc('tools/list', {}, readToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('list_organizations');
    expect(names).toContain('list_dienstgrade');
    expect(names).not.toContain('create_user');
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it('führt ein Werkzeug aus', async () => {
    const response = await POST(rpc('tools/call', { name: 'list_dienstgrade', arguments: {} }, readToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBeFalsy();
    expect(JSON.parse(body.result.content[0].text).items.length).toBeGreaterThan(10);
  });

  it('antwortet bei ausgeschaltetem Funktionsschalter mit 404', async () => {
    await setMcpEnabled(false);
    try {
      expect((await POST(rpc('tools/list', {}, readToken))).status).toBe(404);
    } finally {
      await setMcpEnabled(true);
    }
  });

  it('beantwortet OPTIONS (CORS)', async () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
