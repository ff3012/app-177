import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateBearer } from '@/lib/mcp/auth';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { CORS_HEADERS, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { getIssuer } from '@/lib/mcp/oauth/metadata';
import { createMcpServer } from '@/lib/mcp/server';

// Bewusst keine Origin-/DNS-Rebinding-Prüfung: Remote-Server mit Bearer-Token, CORS "*" und ohne Cookies - ein
// fremder Origin kann ohne Token nichts erreichen, und es gibt keine ambiente Berechtigung, die er mitnehmen könnte.

export function OPTIONS() {
  return optionsResponse();
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(status: number, error: string, description: string, extraHeaders: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify({ error, error_description: description }), {
      status,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
    }),
  );
}

function unauthorized(status: 401 | 403, hadCredentials: boolean): Response {
  const resourceMetadata = `${getIssuer()}/.well-known/oauth-protected-resource/api/mcp`;
  if (status === 403) {
    return jsonError(403, 'insufficient_scope', 'Für diesen Zugriff fehlt die nötige Berechtigung.', {
      'WWW-Authenticate': `Bearer error="insufficient_scope", resource_metadata="${resourceMetadata}"`,
    });
  }
  // Ohne mitgesendete Anmeldedaten gehört kein error-Parameter in die Herausforderung (RFC 6750, 3.1).
  const challenge = hadCredentials
    ? `Bearer error="invalid_token", resource_metadata="${resourceMetadata}"`
    : `Bearer resource_metadata="${resourceMetadata}"`;
  return jsonError(401, 'invalid_token', 'Das Zugriffstoken fehlt, ist ungültig oder abgelaufen.', { 'WWW-Authenticate': challenge });
}

/** Zustandsloser Betrieb: es gibt keinen Server-zu-Client-Stream und keine Sitzung, die man beenden könnte. */
function methodNotAllowed(): Response {
  return withCors(
    new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Methode nicht erlaubt.' }, id: null }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' },
    }),
  );
}

/**
 * MCP über Streamable HTTP, zustandslos: je Anfrage ein eigener Server und Transport (kein Session-Speicher, daher
 * mehrere Container und Neustarts unkritisch). `enableJsonResponse` liefert normale JSON-Antworten statt SSE.
 */
async function handle(request: Request): Promise<Response> {
  try {
    if (!(await isMcpEnabled())) return withCors(notFoundResponse());

    // GET würde einen SSE-Stream öffnen, der nie schließt (nichts schreibt je hinein); DELETE beendet Sitzungen, die es nicht gibt.
    if (request.method !== 'POST') return methodNotAllowed();

    const authorization = request.headers.get('authorization');
    const auth = await authenticateBearer(authorization);
    if (!auth.ok) return unauthorized(auth.status, authorization !== null);

    const server = createMcpServer(auth.principal);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch (error) {
    // Nur ein harmloser Auszug ins Log - nie Anfrage, Header oder das ganze Fehlerobjekt (könnten das Token enthalten).
    const code = (error as { code?: unknown } | null)?.code;
    const safe = typeof code === 'string' ? code : String((error as { message?: unknown } | null)?.message ?? 'unbekannt').slice(0, 200);
    console.error('MCP-Endpunkt: unerwarteter Fehler:', safe);
    return jsonError(500, 'server_error', 'Interner Fehler.');
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
