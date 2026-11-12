import { describe, expect, it } from 'vitest';
import { buildRedirect, isAllowedRedirectUri } from './redirect-uris';

describe('isAllowedRedirectUri', () => {
  it('erlaubt https nur auf den festgelegten Pfaden', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector/oauth/abc123')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector/oauth/abc/def')).toBe(true);
  });

  it('erlaubt eine Query, solange der Pfad passt', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback?x=1')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector/oauth/abc?x=1')).toBe(true);
  });

  it('lehnt andere Pfade auf bekannten Hosts ab', () => {
    expect(isAllowedRedirectUri('https://claude.ai/other')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback/evil')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callbackx')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/x/../api/mcp/auth_callback/../evil')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.com/other')).toBe(false);
    expect(isAllowedRedirectUri('https://chatgpt.com/other')).toBe(false);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector/oauth')).toBe(false);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector/other/abc')).toBe(false);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect/evil')).toBe(false);
  });

  it('lehnt Fragmente, www-Hosts und fremde Ports ab', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback#frag')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback?x=1#frag')).toBe(false);
    expect(isAllowedRedirectUri('https://www.claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedRedirectUri('https://www.chatgpt.com/connector_platform_oauth_redirect')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai:8443/api/mcp/auth_callback')).toBe(false);
  });

  it('erlaubt http nur für localhost, 127.0.0.1 und [::1] (beliebiger Port/Pfad)', () => {
    expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://[::1]:8080/cb')).toBe(true);
  });

  it('lehnt fremde Hosts, http auf Internet-Hosts und andere Schemas ab', () => {
    expect(isAllowedRedirectUri('https://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://evil.example/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai.evil.example/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedRedirectUri('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedRedirectUri('https://localhost/cb')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('claude://callback')).toBe(false);
    expect(isAllowedRedirectUri('kein url')).toBe(false);
    expect(isAllowedRedirectUri('https://user:pw@claude.ai/api/mcp/auth_callback')).toBe(false);
  });
});

describe('buildRedirect', () => {
  it('hängt Parameter an und erhält eine vorhandene Query', () => {
    expect(buildRedirect('https://claude.ai/cb', { code: 'abc', state: 'xyz' })).toBe('https://claude.ai/cb?code=abc&state=xyz');
    expect(buildRedirect('https://claude.ai/cb?a=1', { code: 'abc' })).toBe('https://claude.ai/cb?a=1&code=abc');
  });

  it('lässt undefinierte Parameter weg', () => {
    expect(buildRedirect('https://claude.ai/cb', { code: 'abc', state: undefined })).toBe('https://claude.ai/cb?code=abc');
  });

  it('kodiert Sonderzeichen im state, sodass sie nicht aus dem Parameter ausbrechen', () => {
    const state = 'a b&c=d#e?f/g+h%i';
    const built = buildRedirect('https://claude.ai/api/mcp/auth_callback', { code: 'abc', state });
    const url = new URL(built);
    expect(url.hash).toBe('');
    expect(url.pathname).toBe('/api/mcp/auth_callback');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code')).toBe('abc');
    expect([...url.searchParams.keys()]).toEqual(['code', 'state']);
  });
});
