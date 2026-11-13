import { OauthError } from './errors';

/** Metadaten und Endpunkte sind öffentlich lesbar; browserbasierte Clients (z. B. MCP Inspector) brauchen CORS. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
} as const;

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extraHeaders },
  });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Antwort, wenn der Funktionsschalter aus ist: wie "nicht vorhanden". */
export function notFoundResponse(): Response {
  return new Response(null, { status: 404 });
}

export function oauthErrorResponse(error: OauthError, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse({ error: error.code, error_description: error.message }, error.status, extraHeaders);
}

/** 429 mit Retry-After (Sekunden) aus checkRateLimit. */
export function rateLimitedResponse(message: string, retryAfterSeconds: number): Response {
  return oauthErrorResponse(new OauthError('invalid_request', message, 429), { 'Retry-After': String(retryAfterSeconds) });
}
