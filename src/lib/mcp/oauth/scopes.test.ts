import { describe, expect, it } from 'vitest';
import { grantedScope, parseScope, scopeLevel } from './scopes';

describe('parseScope', () => {
  it('liefert nur bekannte Scopes ohne Duplikate', () => {
    expect(parseScope('mcp:read mcp:write mcp:read foo')).toEqual(['mcp:read', 'mcp:write']);
    expect(parseScope('')).toEqual([]);
    expect(parseScope(null)).toEqual([]);
    expect(parseScope(undefined)).toEqual([]);
  });
});

describe('grantedScope', () => {
  it('ohne Anfrage bekommt man alles, was die eigene Stufe erlaubt', () => {
    expect(grantedScope(undefined, 'WRITE')).toBe('mcp:read mcp:write');
    expect(grantedScope(undefined, 'READ')).toBe('mcp:read');
    expect(grantedScope('', 'READ')).toBe('mcp:read');
  });

  it('behandelt eine Anfrage mit NUR unbekannten Scopes wie "keine Anfrage" und gewährt die volle eigene Stufe', () => {
    // Bewusst so (z. B. scope=openid von generischen OAuth-Clients): unbekannte Scopes werden verworfen, bleibt nichts
    // übrig, gilt der Standard - alles, was die Stufe erlaubt. Mehr als die eigene Stufe gibt es nie.
    expect(grantedScope('openid', 'WRITE')).toBe('mcp:read mcp:write');
    expect(grantedScope('openid profile', 'READ')).toBe('mcp:read');
    expect(grantedScope('openid', 'NONE')).toBe('');
  });

  it('schneidet die Anfrage auf die eigene Stufe zu', () => {
    expect(grantedScope('mcp:read mcp:write', 'READ')).toBe('mcp:read');
    expect(grantedScope('mcp:read', 'WRITE')).toBe('mcp:read');
    expect(grantedScope('mcp:write', 'WRITE')).toBe('mcp:write');
  });

  it('liefert einen Leerstring, wenn nichts gewährt werden kann', () => {
    expect(grantedScope('mcp:write', 'READ')).toBe('');
    expect(grantedScope('mcp:read', 'NONE')).toBe('');
    expect(grantedScope(undefined, 'NONE')).toBe('');
  });
});

describe('scopeLevel', () => {
  it('leitet die Stufe aus dem höchsten Scope ab', () => {
    expect(scopeLevel('mcp:read mcp:write')).toBe('WRITE');
    expect(scopeLevel('mcp:write')).toBe('WRITE');
    expect(scopeLevel('mcp:read')).toBe('READ');
    expect(scopeLevel('')).toBe('NONE');
  });
});
