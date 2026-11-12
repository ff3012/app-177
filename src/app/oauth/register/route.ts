import { getClientIp } from '@/lib/auth/client-ip';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { jsonResponse, notFoundResponse, oauthErrorResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { registerClient } from '@/lib/mcp/oauth/service';
import { checkRateLimit } from '@/lib/mcp/rate-limit';

export function OPTIONS() {
  return optionsResponse();
}

/** Dynamic Client Registration (RFC 7591): JSON {client_name, redirect_uris[]} -> 201 mit client_id. */
export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return notFoundResponse();
  const ip = await getClientIp();
  if (!checkRateLimit(`oauth-register:${ip}`, 20, 60 * 60 * 1000).allowed) {
    return oauthErrorResponse(new OauthError('invalid_request', 'Zu viele Registrierungen, bitte später erneut versuchen.', 429));
  }

  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(new OauthError('invalid_client_metadata', 'Der Body muss JSON sein.'));
  }

  try {
    const client = await registerClient({ clientName: body.client_name, redirectUris: body.redirect_uris });
    return jsonResponse(
      {
        client_id: client.clientId,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      201,
    );
  } catch (error) {
    if (error instanceof OauthError) return oauthErrorResponse(error);
    console.error('OAuth-Registrierung fehlgeschlagen:', error);
    return oauthErrorResponse(new OauthError('server_error', 'Interner Fehler.', 500));
  }
}
