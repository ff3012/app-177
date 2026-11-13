import { MCP_SCOPES } from './scopes';

/** Issuer = AUTH_URL (kanonische Domain, ohne Schrägstrich am Ende). Die alte PROD-Domain ist nie Issuer. */
export function getIssuer(): string {
  return (process.env.AUTH_URL ?? '').replace(/\/$/, '');
}

/** RFC 9728 (Protected Resource Metadata) für /api/mcp. */
export function protectedResourceMetadata(issuer: string) {
  return {
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
  };
}

/** RFC 8414 (Authorization Server Metadata). */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_SCOPES],
  };
}
