import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateBearer } from '@/lib/mcp/auth';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { CORS_HEADERS, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { getIssuer } from '@/lib/mcp/oauth/metadata';
import { createMcpServer } from '@/lib/mcp/server';

export function OPTIONS() {
  return optionsResponse();
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function unauthorized(status: 401 | 403, error: 'invalid_token' | 'insufficient_scope'): Response {
  const resourceMetadata = `${getIssuer()}/.well-known/oauth-protected-resource/api/mcp`;
  const challenge =
    status === 401
      ? `Bearer resource_metadata="${resourceMetadata}"`
      : `Bearer error="insufficient_scope", resource_metadata="${resourceMetadata}"`;
  return withCors(
    new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge } }),
  );
}

/**
 * MCP über Streamable HTTP, zustandslos: je Anfrage ein eigener Server und Transport (kein Session-Speicher, daher
 * mehrere Container und Neustarts unkritisch). `enableJsonResponse` liefert normale JSON-Antworten statt SSE.
 */
async function handle(request: Request): Promise<Response> {
  if (!(await isMcpEnabled())) return notFoundResponse();

  const auth = await authenticateBearer(request.headers.get('authorization'));
  if (!auth.ok) return unauthorized(auth.status, auth.error);

  const server = createMcpServer(auth.principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
