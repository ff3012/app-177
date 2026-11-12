import { prisma } from '@/lib/db/prisma';
import { hasMcpAccess } from '@/lib/mcp/access';
import { OauthError } from './errors';
import { isAllowedRedirectUri } from './redirect-uris';
import { grantedScope } from './scopes';
import { hashSecret, isValidCodeChallenge, randomSecret } from './secrets';

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- Client-Registrierung

/** Dynamic Client Registration (RFC 7591), nur öffentliche Clients. */
export async function registerClient(input: { clientName: unknown; redirectUris: unknown }) {
  const name = typeof input.clientName === 'string' ? input.clientName.trim().slice(0, 100) : '';
  if (!name) throw new OauthError('invalid_client_metadata', 'client_name fehlt.');
  const uris = input.redirectUris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === 'string')) {
    throw new OauthError('invalid_client_metadata', 'redirect_uris muss 1 bis 5 Adressen enthalten.');
  }
  if (!(uris as string[]).every(isAllowedRedirectUri)) {
    throw new OauthError('invalid_redirect_uri', 'Mindestens eine Rücksprungadresse ist nicht erlaubt.');
  }
  const created = await prisma.oauthClient.create({
    data: { clientId: `mcp_${randomSecret(16)}`, name, redirectUris: uris as string[] },
  });
  return { clientId: created.clientId, name: created.name, redirectUris: created.redirectUris };
}

// ---------------------------------------------------------------- Autorisierungsanfrage

export interface AuthorizeRequest {
  oauthClientId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state?: string;
}

export type AuthorizeValidation =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; fatal: true; message: string }
  | { ok: false; fatal: false; redirectUri: string; error: string; errorDescription: string; state?: string };

/**
 * Prüft die Parameter von /oauth/authorize. Unbekannter Client oder nicht registrierte Rücksprungadresse sind
 * "fatal": dann darf NIE weitergeleitet werden (sonst Open Redirect), es gibt nur eine Fehlerseite. Alle anderen
 * Fehler gehen als error=... an die (bereits geprüfte) Rücksprungadresse.
 */
export async function validateAuthorizeRequest(params: Record<string, string | undefined>): Promise<AuthorizeValidation> {
  const client = params.client_id ? await prisma.oauthClient.findUnique({ where: { clientId: params.client_id } }) : null;
  if (!client) return { ok: false, fatal: true, message: 'Unbekannte Anwendung (client_id).' };
  const redirectUri = params.redirect_uri;
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    return { ok: false, fatal: true, message: 'Die Rücksprungadresse ist für diese Anwendung nicht registriert.' };
  }

  const fail = (error: string, errorDescription: string): AuthorizeValidation => ({
    ok: false,
    fatal: false,
    redirectUri,
    error,
    errorDescription,
    state: params.state,
  });

  if (params.response_type !== 'code') return fail('unsupported_response_type', 'Nur response_type=code wird unterstützt.');
  if (!params.code_challenge || !isValidCodeChallenge(params.code_challenge)) {
    return fail('invalid_request', 'code_challenge fehlt oder ist ungültig.');
  }
  if (params.code_challenge_method !== 'S256') return fail('invalid_request', 'Nur code_challenge_method=S256 wird unterstützt.');

  return {
    ok: true,
    request: {
      oauthClientId: client.id,
      clientId: client.clientId,
      clientName: client.name,
      redirectUri,
      codeChallenge: params.code_challenge,
      scope: params.scope ?? '',
      state: params.state,
    },
  };
}

/**
 * Erzeugt nach der Zustimmung den einmaligen Code. Der Umfang wird hier endgültig auf die aktuelle Stufe des
 * Benutzers zugeschnitten; ohne aktives Konto oder ohne MCP-Zugriff gibt es keinen Code.
 */
export async function createAuthorizationCode(input: { userId: string; request: AuthorizeRequest }): Promise<{ code: string }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { isActive: true, mcpAccess: true } });
  if (!user || !user.isActive || !hasMcpAccess(user.mcpAccess, 'READ')) {
    throw new OauthError('access_denied', 'Dieses Konto hat keinen MCP-Zugriff.', 403);
  }
  const scope = grantedScope(input.request.scope, user.mcpAccess);
  if (!scope) throw new OauthError('invalid_scope', 'Der gewünschte Umfang ist für dieses Konto nicht erlaubt.');

  const code = randomSecret();
  await prisma.oauthAuthorizationCode.create({
    data: {
      codeHash: hashSecret(code),
      oauthClientId: input.request.oauthClientId,
      userId: input.userId,
      redirectUri: input.request.redirectUri,
      codeChallenge: input.request.codeChallenge,
      scope,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return { code };
}
