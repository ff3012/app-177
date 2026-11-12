import { getClientIp } from '@/lib/auth/client-ip';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { jsonResponse, notFoundResponse, optionsResponse, rateLimitedResponse } from '@/lib/mcp/oauth/http';
import { revokeToken } from '@/lib/mcp/oauth/service';
import { checkRateLimit } from '@/lib/mcp/rate-limit';

export function OPTIONS() {
  return optionsResponse();
}

/** RFC 7009: antwortet immer 200, auch bei unbekanntem Token (verrät nicht, ob es existiert). */
export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return notFoundResponse();
  const ip = await getClientIp();
  const limit = checkRateLimit(`oauth-revoke:${ip}`, 60, 60_000);
  if (!limit.allowed) return rateLimitedResponse('Zu viele Anfragen.', limit.retryAfterSeconds);
  const params = new URLSearchParams(await request.text());
  const token = params.get('token');
  if (token) await revokeToken({ token, clientId: params.get('client_id') ?? undefined });
  return jsonResponse({});
}
