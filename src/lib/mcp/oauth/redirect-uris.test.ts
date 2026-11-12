import { describe, expect, it } from 'vitest';
import { buildRedirect, isAllowedRedirectUri } from './redirect-uris';

describe('isAllowedRedirectUri', () => {
  it('erlaubt https auf den bekannten Hosts', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
  });

  it('erlaubt http nur für localhost, 127.0.0.1 und [::1] (beliebiger Port/Pfad)', () => {
    expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://[::1]:8080/cb')).toBe(true);
  });

  it('lehnt fremde Hosts, http auf Internet-Hosts, Fragmente und andere Schemas ab', () => {
    expect(isAllowedRedirectUri('https://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai.evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('http://claude.ai/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/cb#frag')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('claude://callback')).toBe(false);
    expect(isAllowedRedirectUri('kein url')).toBe(false);
    expect(isAllowedRedirectUri('https://user:pw@claude.ai/cb')).toBe(false);
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
});
