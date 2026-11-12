import { getClientIp } from '@/lib/auth/client-ip';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { jsonResponse, notFoundResponse, oauthErrorResponse, optionsResponse, rateLimitedResponse } from '@/lib/mcp/oauth/http';
import { exchangeAuthorizationCode, refreshAccessToken } from '@/lib/mcp/oauth/service';
import { checkRateLimit } from '@/lib/mcp/rate-limit';

export function OPTIONS() {
  return optionsResponse();
}

/** Token-Endpunkt (RFC 6749 §3.2), Body application/x-www-form-urlencoded. */
export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return notFoundResponse();
  const ip = await getClientIp();
  const limit = checkRateLimit(`oauth-token:${ip}`, 60, 60_000);
  if (!limit.allowed) return rateLimitedResponse('Zu viele Anfragen.', limit.retryAfterSeconds);

  const params = new URLSearchParams(await request.text());
  const clientId = params.get('client_id') ?? '';

  try {
    switch (params.get('grant_type')) {
      case 'authorization_code':
        return jsonResponse(
          await exchangeAuthorizationCode({
            code: params.get('code') ?? '',
            clientId,
            redirectUri: params.get('redirect_uri') ?? '',
            codeVerifier: params.get('code_verifier') ?? '',
          }),
        );
      case 'refresh_token':
        return jsonResponse(await refreshAccessToken({ refreshToken: params.get('refresh_token') ?? '', clientId }));
      default:
        throw new OauthError('unsupported_grant_type', 'Nur authorization_code und refresh_token werden unterstützt.');
    }
  } catch (error) {
    if (error instanceof OauthError) return oauthErrorResponse(error);
    console.error('OAuth-Token-Endpunkt fehlgeschlagen:', error);
    return oauthErrorResponse(new OauthError('server_error', 'Interner Fehler.', 500));
  }
}
