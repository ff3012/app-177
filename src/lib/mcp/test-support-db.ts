import crypto from 'crypto';
import { createAuthorizationCode, exchangeAuthorizationCode, registerClient, validateAuthorizeRequest } from './oauth/service';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 't'.repeat(60);
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');

/**
 * Nur für Datenbank-Tests: durchläuft Registrierung → Code → Token für einen vorhandenen Benutzer und liefert die
 * rohen Token. `namePrefix` MUSS mit dem RUN-Präfix des Tests beginnen, damit der Test den Client am Ende über
 * `oauthClient.deleteMany({ where: { name: { startsWith: RUN } } })` wieder entfernen kann.
 */
export async function issueTestToken(input: { userId: string; namePrefix: string; scope?: string }) {
  const client = await registerClient({ clientName: `${input.namePrefix}-client`, redirectUris: [REDIRECT] });
  const validated = await validateAuthorizeRequest({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: input.scope,
  });
  if (!validated.ok) throw new Error('Testanfrage ungültig');
  const { code } = await createAuthorizationCode({ userId: input.userId, request: validated.request });
  const tokens = await exchangeAuthorizationCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}
