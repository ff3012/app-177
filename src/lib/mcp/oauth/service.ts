import { prisma } from '@/lib/db/prisma';
import { hasMcpAccess } from '@/lib/mcp/access';
import { OauthError } from './errors';
import { isAllowedRedirectUri } from './redirect-uris';
import { grantedScope } from './scopes';
import { hashSecret, isValidCodeChallenge, randomSecret, verifyPkceS256 } from './secrets';

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

// ---------------------------------------------------------------- Token

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const invalidGrant = (message = 'Der Code oder Refresh-Token ist ungültig, abgelaufen oder bereits benutzt.') =>
  new OauthError('invalid_grant', message);

async function issueTokens(input: { userId: string; oauthClientId: string; scope: string }): Promise<TokenResponse> {
  const accessToken = randomSecret();
  const refreshToken = randomSecret();
  await prisma.oauthToken.create({
    data: {
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      oauthClientId: input.oauthClientId,
      userId: input.userId,
      scope: input.scope,
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: input.scope,
  };
}

/**
 * Autorisierungscode gegen Token tauschen. PKCE wird VOR dem Verbrauch geprüft (Fehlversuche verbrennen den Code
 * nicht und erlauben kein Raten); der Verbrauch selbst ist atomar (updateMany ... usedAt: null), zwei gleichzeitige
 * Einlösungen können also nie beide gelingen.
 */
export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const row = await prisma.oauthAuthorizationCode.findUnique({
    where: { codeHash: hashSecret(input.code) },
    include: { oauthClient: true },
  });
  if (
    !row ||
    row.usedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    row.oauthClient.clientId !== input.clientId ||
    row.redirectUri !== input.redirectUri ||
    !verifyPkceS256(input.codeVerifier, row.codeChallenge)
  ) {
    throw invalidGrant();
  }

  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { isActive: true, mcpAccess: true } });
  if (!user || !user.isActive || !hasMcpAccess(user.mcpAccess, 'READ')) throw invalidGrant('Dieses Konto hat keinen MCP-Zugriff.');
  const scope = grantedScope(row.scope, user.mcpAccess);
  if (!scope) throw invalidGrant();

  const claimed = await prisma.oauthAuthorizationCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalidGrant();

  return issueTokens({ userId: row.userId, oauthClientId: row.oauthClientId, scope });
}

/** Widerruft alle noch gültigen Token eines Benutzers (optional nur für einen Client). Gibt die Anzahl zurück. */
export async function revokeTokensOfUser(userId: string, oauthClientId?: string): Promise<number> {
  const result = await prisma.oauthToken.updateMany({
    where: { userId, revokedAt: null, ...(oauthClientId ? { oauthClientId } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Refresh mit Rotation: der vorgelegte Refresh-Token wird widerrufen und ein neuer Satz ausgegeben. Legt jemand einen
 * bereits widerrufenen/ersetzten Refresh-Token vor, gilt das als Diebstahlsverdacht - dann werden ALLE Token des
 * Benutzers für diesen Client widerrufen. Der Umfang wird auf die aktuelle Stufe zugeschnitten.
 */
export async function refreshAccessToken(input: { refreshToken: string; clientId: string }): Promise<TokenResponse> {
  const row = await prisma.oauthToken.findUnique({
    where: { refreshTokenHash: hashSecret(input.refreshToken) },
    include: { oauthClient: true },
  });
  if (!row || row.oauthClient.clientId !== input.clientId) throw invalidGrant();

  if (row.revokedAt) {
    await revokeTokensOfUser(row.userId, row.oauthClientId);
    throw invalidGrant();
  }
  if (row.refreshExpiresAt.getTime() <= Date.now()) throw invalidGrant();

  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { isActive: true, mcpAccess: true } });
  if (!user || !user.isActive || !hasMcpAccess(user.mcpAccess, 'READ')) {
    await revokeTokensOfUser(row.userId, row.oauthClientId);
    throw invalidGrant('Dieses Konto hat keinen MCP-Zugriff.');
  }
  const scope = grantedScope(row.scope, user.mcpAccess);
  if (!scope) throw invalidGrant();

  const rotated = await prisma.oauthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (rotated.count !== 1) throw invalidGrant();

  return issueTokens({ userId: row.userId, oauthClientId: row.oauthClientId, scope });
}

/** RFC 7009: Access- oder Refresh-Token widerrufen; unbekannte Werte werden stillschweigend ignoriert. */
export async function revokeToken(input: { token: string; clientId?: string }): Promise<void> {
  const hash = hashSecret(input.token);
  await prisma.oauthToken.updateMany({
    where: {
      revokedAt: null,
      OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
      ...(input.clientId ? { oauthClient: { clientId: input.clientId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}
