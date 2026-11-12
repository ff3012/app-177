import { afterEach, describe, expect, it } from 'vitest';
import { authorizationServerMetadata, getIssuer, protectedResourceMetadata } from './metadata';

const ISSUER = 'https://app-17.example.test';

describe('getIssuer', () => {
  const original = process.env.AUTH_URL;
  afterEach(() => {
    process.env.AUTH_URL = original;
  });

  it('nimmt AUTH_URL ohne Schrägstrich am Ende', () => {
    process.env.AUTH_URL = 'https://app-17.example.test/';
    expect(getIssuer()).toBe(ISSUER);
  });
});

describe('protectedResourceMetadata', () => {
  it('nennt die Resource und den Authorization Server', () => {
    expect(protectedResourceMetadata(ISSUER)).toEqual({
      resource: `${ISSUER}/api/mcp`,
      authorization_servers: [ISSUER],
      scopes_supported: ['mcp:read', 'mcp:write'],
      bearer_methods_supported: ['header'],
    });
  });
});

describe('authorizationServerMetadata', () => {
  const meta = authorizationServerMetadata(ISSUER);

  it('verweist auf alle Endpunkte', () => {
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.authorization_endpoint).toBe(`${ISSUER}/oauth/authorize`);
    expect(meta.token_endpoint).toBe(`${ISSUER}/oauth/token`);
    expect(meta.registration_endpoint).toBe(`${ISSUER}/oauth/register`);
    expect(meta.revocation_endpoint).toBe(`${ISSUER}/oauth/revoke`);
  });

  it('verlangt PKCE S256, kennt nur öffentliche Clients und beide Grant-Typen', () => {
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(meta.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(meta.response_types_supported).toEqual(['code']);
  });
});
