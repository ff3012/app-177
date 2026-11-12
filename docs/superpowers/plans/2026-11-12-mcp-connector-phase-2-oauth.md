# MCP-Connector · Phase 2: OAuth-Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein kleiner OAuth-2.1-Server in der App (Authorization Code + PKCE S256, Dynamic Client Registration, Refresh-Rotation, Widerruf), über den sich Claude und ChatGPT mit dem bestehenden App-Login anmelden. Am Ende dieser Phase kann ein Client Token erhalten, aber noch kein Werkzeug aufrufen (das ist Phase 3).

**Architecture:** Reine Bausteine (Geheimnisse/PKCE, Scopes, erlaubte Rücksprungadressen, Metadaten) in `src/lib/mcp/oauth/`, die Logik mit Datenbank in einer Service-Datei (`service.ts`), die von dünnen Route Handlers (`/oauth/token|register|revoke`, `/.well-known/*`) und einer Server-Component-Seite mit Server Actions (`/oauth/authorize`) aufgerufen wird. Alles hängt am Funktionsschalter `isMcpEnabled()`; ausgeschaltet antwortet jeder Endpunkt mit 404.

**Tech Stack:** Next.js 15 Route Handlers, Prisma, Node `crypto`, vitest.

**Voraussetzung:** Phase 1 ist umgesetzt (Tabellen `OauthClient`, `OauthAuthorizationCode`, `OauthToken`; `User.mcpAccess`; `isMcpEnabled`, `getMcpAccessOf`, `checkRateLimit`, `McpAccessLevel`, `hasMcpAccess`).

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-connector-design.md`

## Global Constraints

- **Codes und Token nur als SHA-256-Hash** in der Datenbank; der rohe Wert existiert nur in der Antwort an den Client.
- **Lebensdauern:** Autorisierungscode 60 Sekunden und einmalig; Access-Token 1 Stunde; Refresh-Token 30 Tage, rotierend.
- **Refresh-Wiederverwendung:** Wird ein bereits ersetzter (widerrufener) Refresh-Token vorgelegt, werden **alle** noch gültigen Token dieses Benutzers für diesen Client widerrufen.
- **PKCE S256 ist Pflicht**, `plain` wird abgelehnt. Es gibt nur öffentliche Clients (`token_endpoint_auth_method: none`).
- **Rücksprungadressen:** nur `https` auf `claude.ai`, `chatgpt.com` (und deren bekannte Hosts) sowie `http` auf `localhost`/`127.0.0.1`/`[::1]`. Eine nicht registrierte oder nicht erlaubte Adresse führt **nie** zu einer Weiterleitung (Fehlerseite statt Redirect).
- **Gewährter Umfang** = Anfrage ∩ `mcpAccess` des Benutzers (`mcp:read` braucht READ, `mcp:write` braucht WRITE). Wird beim Einlösen und bei jedem Refresh neu berechnet.
- **Issuer/Resource** leiten sich aus `AUTH_URL` ab (ohne Schrägstrich am Ende); die alte PROD-Domain ist nie Issuer.
- **Mengenbegrenzung** je IP (`checkRateLimit`): `/oauth/token` 60/min, `/oauth/register` 20/Stunde, `/oauth/revoke` 60/min.
- **Antworten** auf Token- und Registrierungs-Endpunkte mit `Cache-Control: no-store`.
- **Middleware:** öffentlich werden nur `/.well-known`, `/api/mcp`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`. `/oauth/authorize` bleibt geschützt (Login-Weiterleitung).
- **Keine Geheimnisse in Logs**, keine neuen Umgebungsvariablen.
- Übrige Konventionen wie in Phase 1 (CRLF, Tests, Commits nur auf Anweisung, Deutsch in Oberfläche).

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/lib/mcp/oauth/secrets.ts` | `randomSecret`, `hashSecret`, `verifyPkceS256`, `isValidCodeChallenge` |
| `src/lib/mcp/oauth/errors.ts` | `OauthError` |
| `src/lib/mcp/oauth/scopes.ts` | `parseScope`, `grantedScope`, `scopeLevel` |
| `src/lib/mcp/oauth/redirect-uris.ts` | `isAllowedRedirectUri`, `buildRedirect` |
| `src/lib/mcp/oauth/metadata.ts` | `getIssuer`, `protectedResourceMetadata`, `authorizationServerMetadata` |
| `src/lib/mcp/oauth/http.ts` | `CORS_HEADERS`, `jsonResponse`, `optionsResponse`, `notFoundResponse`, `oauthErrorResponse` |
| `src/lib/mcp/oauth/service.ts` | Clients, Autorisierung, Code einlösen, Refresh, Widerruf |
| `src/app/.well-known/**/route.ts` | Discovery-Dokumente |
| `src/app/oauth/{register,token,revoke}/route.ts` | Endpunkte |
| `src/app/oauth/authorize/{page.tsx,actions.ts}` | Anmelde-/Zustimmungsseite |
| `src/lib/auth/callback-url.ts` | `buildLoginCallbackUrl` (Query für `/oauth/authorize` erhalten) |
| `src/middleware.ts` (ändern) | öffentliche Pfade, `callbackUrl` mit Query |

---

### Task 1: Geheimnisse und PKCE

**Files:**
- Create: `src/lib/mcp/oauth/secrets.ts`
- Test: `src/lib/mcp/oauth/secrets.test.ts`

**Interfaces:**
- Produces: `randomSecret(bytes?: number): string` (base64url), `hashSecret(secret: string): string` (SHA-256 hex), `isValidCodeChallenge(value: string): boolean` (43 Zeichen base64url), `verifyPkceS256(verifier: string, challenge: string): boolean` (Verifier 43–128 Zeichen aus `A-Za-z0-9-._~`, zeitkonstanter Vergleich).

- [ ] **Step 1: Failing Test**

Create `src/lib/mcp/oauth/secrets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashSecret, isValidCodeChallenge, randomSecret, verifyPkceS256 } from './secrets';

describe('randomSecret / hashSecret', () => {
  it('erzeugt lange, verschiedene, URL-sichere Werte', () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hasht deterministisch zu 64 Hex-Zeichen', () => {
    expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('verifyPkceS256', () => {
  // Beispiel aus RFC 7636 Anhang B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('akzeptiert das RFC-Beispiel', () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('lehnt einen falschen Verifier ab', () => {
    expect(verifyPkceS256('x'.repeat(43), challenge)).toBe(false);
  });

  it('lehnt zu kurze, zu lange und ungültige Verifier ab', () => {
    expect(verifyPkceS256('kurz', challenge)).toBe(false);
    expect(verifyPkceS256('a'.repeat(129), challenge)).toBe(false);
    expect(verifyPkceS256('a'.repeat(42) + '!', challenge)).toBe(false);
  });
});

describe('isValidCodeChallenge', () => {
  it('verlangt genau 43 Zeichen base64url (SHA-256)', () => {
    expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(isValidCodeChallenge('zu-kurz')).toBe(false);
    expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c=')).toBe(false);
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/mcp/oauth/secrets.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/oauth/secrets.ts`:

```ts
import crypto from 'crypto';

/** Zufälliger, URL-sicherer Wert (Standard 32 Byte = 43 Zeichen). */
export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** SHA-256 als Hex - so werden Codes und Token gespeichert (wie PasswordToken). */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Eine S256-Code-Challenge ist base64url(SHA-256) = genau 43 Zeichen. */
export function isValidCodeChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** RFC 7636: Verifier 43-128 Zeichen aus unreserved; Vergleich zeitkonstant. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/mcp/oauth/secrets.test.ts` → PASS (6 Tests).

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/oauth/secrets.ts src/lib/mcp/oauth/secrets.test.ts
git commit -m "feat: OAuth-Bausteine für Geheimnisse und PKCE"
```

---

### Task 2: Fehler, Scopes, Rücksprungadressen

**Files:**
- Create: `src/lib/mcp/oauth/errors.ts`, `src/lib/mcp/oauth/scopes.ts`, `src/lib/mcp/oauth/redirect-uris.ts`
- Test: `src/lib/mcp/oauth/scopes.test.ts`, `src/lib/mcp/oauth/redirect-uris.test.ts`

**Interfaces:**
- Produces:
  - `class OauthError extends Error { code: string; status: number }` — `new OauthError(code, message, status = 400)`
  - `MCP_SCOPES = ['mcp:read', 'mcp:write'] as const`
  - `parseScope(scope: string | null | undefined): string[]` (nur bekannte Scopes, ohne Duplikate)
  - `grantedScope(requested: string | null | undefined, access: McpAccessLevel): string` — Leerstring, wenn nichts gewährt werden kann
  - `scopeLevel(scope: string): McpAccessLevel`
  - `isAllowedRedirectUri(uri: string): boolean`, `buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string`

- [ ] **Step 1: Failing Tests**

Create `src/lib/mcp/oauth/scopes.test.ts`:

```ts
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
```

Create `src/lib/mcp/oauth/redirect-uris.test.ts`:

```ts
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
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/mcp/oauth/scopes.test.ts src/lib/mcp/oauth/redirect-uris.test.ts` → FAIL.

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/oauth/errors.ts`:

```ts
/** OAuth-Fehler (RFC 6749 §5.2): `code` ist der `error`-Wert, `message` die `error_description`. */
export class OauthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'OauthError';
  }
}
```

Create `src/lib/mcp/oauth/scopes.ts`:

```ts
import { hasMcpAccess, type McpAccessLevel } from '@/lib/mcp/access';

export const MCP_SCOPES = ['mcp:read', 'mcp:write'] as const;
type McpScope = (typeof MCP_SCOPES)[number];

export function parseScope(scope: string | null | undefined): string[] {
  const requested = (scope ?? '').split(/\s+/).filter(Boolean);
  return Array.from(new Set(requested.filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s))));
}

/** Anfrage ∩ eigene Stufe. Ohne Anfrage: alles, was die Stufe erlaubt. Leerstring = nichts gewährbar. */
export function grantedScope(requested: string | null | undefined, access: McpAccessLevel): string {
  const parsed = parseScope(requested);
  const wanted: string[] = parsed.length > 0 ? parsed : [...MCP_SCOPES];
  return wanted
    .filter((scope) => hasMcpAccess(access, scope === 'mcp:write' ? 'WRITE' : 'READ'))
    .join(' ');
}

export function scopeLevel(scope: string): McpAccessLevel {
  const scopes = parseScope(scope);
  if (scopes.includes('mcp:write')) return 'WRITE';
  if (scopes.includes('mcp:read')) return 'READ';
  return 'NONE';
}
```

Create `src/lib/mcp/oauth/redirect-uris.ts`:

```ts
/**
 * Erlaubte Rücksprungadressen für Connector-Clients. Host-genau (kein Suffix-Abgleich), nur https - ausgenommen
 * Loopback für lokale Werkzeuge (z. B. MCP Inspector). VOR dem Livegang gegen die aktuellen Dokumentationen von
 * Claude (support.claude.com, "custom connectors") und OpenAI (developers.openai.com, "developer mode") prüfen -
 * Stand der Planung: claude.ai nutzt https://claude.ai/api/mcp/auth_callback, ChatGPT einen Pfad unter chatgpt.com.
 */
const ALLOWED_HTTPS_HOSTS = new Set(['claude.ai', 'www.claude.ai', 'claude.com', 'chatgpt.com', 'www.chatgpt.com']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return ALLOWED_HTTPS_HOSTS.has(url.hostname);
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return false;
}

/** Hängt Parameter an die Rücksprungadresse (vorhandene Query bleibt erhalten), undefinierte Werte entfallen. */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/mcp/oauth/scopes.test.ts src/lib/mcp/oauth/redirect-uris.test.ts` → PASS (10 Tests). Falls ein `new URL('http://[::1]:8080/cb').hostname` in Node `[::1]` liefert (mit Klammern), passt die Konstante; liefert es `::1`, die Konstante in `LOOPBACK_HOSTS` entsprechend ändern.

- [ ] **Step 5: Rücksprungadressen gegen die Dokumentation prüfen**

Die beiden Dokumentationen öffnen (Claude: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp.md , ChatGPT: https://developers.openai.com/api/docs/guides/developer-mode) und prüfen, dass die dort genannten Redirect-Hosts in `ALLOWED_HTTPS_HOSTS` enthalten sind. Fehlt einer, in die Menge aufnehmen und einen Testfall in `redirect-uris.test.ts` ergänzen.

- [ ] **Step 6: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/oauth
git commit -m "feat: OAuth-Scopes, Fehlerklasse und erlaubte Rücksprungadressen"
```

---

### Task 3: Metadaten und HTTP-Helfer, Discovery-Routen

**Files:**
- Create: `src/lib/mcp/oauth/metadata.ts`, `src/lib/mcp/oauth/http.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`
- Modify: `src/middleware.ts`
- Test: `src/lib/mcp/oauth/metadata.test.ts`

**Interfaces:**
- Consumes: `isMcpEnabled()` (Phase 1), `MCP_SCOPES`, `OauthError` (Task 2).
- Produces: `getIssuer(): string`; `protectedResourceMetadata(issuer: string)`; `authorizationServerMetadata(issuer: string)`; `CORS_HEADERS`; `jsonResponse(body: unknown, status?: number, extraHeaders?: Record<string, string>): Response`; `optionsResponse(): Response`; `notFoundResponse(): Response`; `oauthErrorResponse(error: OauthError): Response`.

- [ ] **Step 1: Failing Test**

Create `src/lib/mcp/oauth/metadata.test.ts`:

```ts
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
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/mcp/oauth/metadata.test.ts` → FAIL.

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/oauth/metadata.ts`:

```ts
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
    scopes_supported: [...MCP_SCOPES],
  };
}
```

Create `src/lib/mcp/oauth/http.ts`:

```ts
import type { OauthError } from './errors';

/** Metadaten und Endpunkte sind öffentlich lesbar; browserbasierte Clients (z. B. MCP Inspector) brauchen CORS. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
} as const;

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extraHeaders },
  });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Antwort, wenn der Funktionsschalter aus ist: wie "nicht vorhanden". */
export function notFoundResponse(): Response {
  return new Response(null, { status: 404 });
}

export function oauthErrorResponse(error: OauthError): Response {
  return jsonResponse({ error: error.code, error_description: error.message }, error.status);
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/mcp/oauth/metadata.test.ts` → PASS (4 Tests).

- [ ] **Step 5: Discovery-Routen**

Create `src/app/.well-known/oauth-authorization-server/route.ts`:

```ts
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { jsonResponse, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { authorizationServerMetadata, getIssuer } from '@/lib/mcp/oauth/metadata';

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  if (!(await isMcpEnabled())) return notFoundResponse();
  return jsonResponse(authorizationServerMetadata(getIssuer()));
}
```

Create `src/app/.well-known/oauth-protected-resource/route.ts`:

```ts
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { jsonResponse, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { getIssuer, protectedResourceMetadata } from '@/lib/mcp/oauth/metadata';

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  if (!(await isMcpEnabled())) return notFoundResponse();
  return jsonResponse(protectedResourceMetadata(getIssuer()));
}
```

Create `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts` (RFC 9728 verlangt für eine Resource mit Pfad `/api/mcp` die Variante mit Pfadsuffix; Clients probieren sie zuerst):

```ts
export { GET, OPTIONS } from '../../route';
```

- [ ] **Step 6: Middleware — öffentliche Pfade**

In `src/middleware.ts` die Liste `PUBLIC_PATH_PREFIXES` um diese Einträge erweitern (vor `'/sw.js'`):

```ts
  '/.well-known',
  '/api/mcp',
  '/oauth/token',
  '/oauth/register',
  '/oauth/revoke',
```

`/oauth/authorize` bewusst **nicht** aufnehmen.

- [ ] **Step 7: Prüfen**

Run: `npx tsc --noEmit` → keine Fehler. Run: `npm run build` → `/.well-known/...` Routen erscheinen in der Liste.

- [ ] **Step 8: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/oauth/metadata.ts src/lib/mcp/oauth/metadata.test.ts src/lib/mcp/oauth/http.ts src/app/.well-known src/middleware.ts
git commit -m "feat: OAuth-Metadaten (Discovery) für den MCP-Connector"
```

---

### Task 4: Service — Client-Registrierung, Autorisierungsanfrage, Code erzeugen

**Files:**
- Create: `src/lib/mcp/oauth/service.ts`
- Test: `src/lib/mcp/oauth/service.db.test.ts`

**Interfaces:**
- Consumes: `OauthError`, `hashSecret`, `randomSecret`, `isValidCodeChallenge`, `grantedScope`, `isAllowedRedirectUri`, `McpAccessLevel`/`hasMcpAccess`.
- Produces:
  - `registerClient(input: { clientName: unknown; redirectUris: unknown }): Promise<{ clientId: string; name: string; redirectUris: string[] }>`
  - `type AuthorizeRequest = { oauthClientId: string; clientId: string; clientName: string; redirectUri: string; codeChallenge: string; scope: string; state?: string }`
  - `type AuthorizeValidation = { ok: true; request: AuthorizeRequest } | { ok: false; fatal: true; message: string } | { ok: false; fatal: false; redirectUri: string; error: string; errorDescription: string; state?: string }`
  - `validateAuthorizeRequest(params: Record<string, string | undefined>): Promise<AuthorizeValidation>`
  - `createAuthorizationCode(input: { userId: string; request: AuthorizeRequest }): Promise<{ code: string }>`

Dieser Task legt die erste Hälfte von `service.ts` an; Task 5 ergänzt Token-Ausgabe, Refresh und Widerruf in derselben Datei.

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/oauth/service.db.test.ts`:

```ts
import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { OauthError } from './errors';
import { createAuthorizationCode, registerClient, validateAuthorizeRequest } from './service';

const RUN = `oauth-${Date.now()}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(50);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

let org: { id: string };
const userIds: Record<string, string> = {};
let client: { clientId: string };

async function makeUser(key: string, mcpAccess: 'NONE' | 'READ' | 'WRITE', isActive = true) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: org.id, mcpAccess, isActive },
  });
  userIds[key] = user.id;
}

beforeAll(async () => {
  org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  await makeUser('none', 'NONE');
  await makeUser('read', 'READ');
  await makeUser('write', 'WRITE');
  await makeUser('inactive', 'WRITE', false);
  client = await registerClient({ clientName: `${RUN}-client`, redirectUris: [REDIRECT] });
});

afterAll(async () => {
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  await prisma.$disconnect();
});

describe('registerClient', () => {
  it('legt einen Client mit erlaubten Rücksprungadressen an', async () => {
    const created = await registerClient({ clientName: `${RUN}-b`, redirectUris: [REDIRECT, 'http://localhost:6274/cb'] });
    expect(created.clientId).toMatch(/^mcp_/);
    expect(created.redirectUris).toEqual([REDIRECT, 'http://localhost:6274/cb']);
  });

  it('lehnt fremde Rücksprungadressen ab', async () => {
    await expect(registerClient({ clientName: `${RUN}-c`, redirectUris: ['https://evil.example/cb'] })).rejects.toMatchObject({
      code: 'invalid_redirect_uri',
    });
  });

  it('lehnt fehlenden Namen und leere Adressliste ab', async () => {
    await expect(registerClient({ clientName: '', redirectUris: [REDIRECT] })).rejects.toBeInstanceOf(OauthError);
    await expect(registerClient({ clientName: `${RUN}-d`, redirectUris: [] })).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(registerClient({ clientName: `${RUN}-e`, redirectUris: 'https://claude.ai/cb' })).rejects.toBeInstanceOf(OauthError);
  });
});

describe('validateAuthorizeRequest', () => {
  const valid = () => ({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp:read',
    state: 'abc',
  });

  it('akzeptiert eine gültige Anfrage', async () => {
    const result = await validateAuthorizeRequest(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.clientName).toBe(`${RUN}-client`);
      expect(result.request.state).toBe('abc');
    }
  });

  it('meldet unbekannten Client und nicht registrierte Rücksprungadresse als fatal (kein Redirect)', async () => {
    expect(await validateAuthorizeRequest({ ...valid(), client_id: 'mcp_gibtsnicht' })).toMatchObject({ ok: false, fatal: true });
    expect(await validateAuthorizeRequest({ ...valid(), redirect_uri: 'https://claude.ai/anderer-pfad' })).toMatchObject({
      ok: false,
      fatal: true,
    });
  });

  it('meldet andere Fehler als Weiterleitung mit error und state', async () => {
    expect(await validateAuthorizeRequest({ ...valid(), response_type: 'token' })).toMatchObject({
      ok: false,
      fatal: false,
      error: 'unsupported_response_type',
      state: 'abc',
    });
    expect(await validateAuthorizeRequest({ ...valid(), code_challenge: undefined })).toMatchObject({ ok: false, fatal: false, error: 'invalid_request' });
    expect(await validateAuthorizeRequest({ ...valid(), code_challenge_method: 'plain' })).toMatchObject({
      ok: false,
      fatal: false,
      error: 'invalid_request',
    });
  });
});

describe('createAuthorizationCode', () => {
  async function request(scope = '') {
    const result = await validateAuthorizeRequest({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope,
    });
    if (!result.ok) throw new Error('Testanfrage ungültig');
    return result.request;
  }

  it('speichert nur den Hash, 60 Sekunden gültig, mit zugeschnittenem Umfang', async () => {
    const { code } = await createAuthorizationCode({ userId: userIds.read, request: await request() });
    const row = await prisma.oauthAuthorizationCode.findFirstOrThrow({ where: { userId: userIds.read }, orderBy: { createdAt: 'desc' } });
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).toHaveLength(64);
    expect(row.scope).toBe('mcp:read');
    expect(row.usedAt).toBeNull();
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(61_000);
  });

  it('WRITE-Benutzer bekommt ohne Anfrage beide Scopes', async () => {
    await createAuthorizationCode({ userId: userIds.write, request: await request() });
    const row = await prisma.oauthAuthorizationCode.findFirstOrThrow({ where: { userId: userIds.write }, orderBy: { createdAt: 'desc' } });
    expect(row.scope).toBe('mcp:read mcp:write');
  });

  it('lehnt Benutzer ohne MCP-Zugriff, deaktivierte und unbekannte Benutzer ab', async () => {
    await expect(createAuthorizationCode({ userId: userIds.none, request: await request() })).rejects.toMatchObject({ code: 'access_denied' });
    await expect(createAuthorizationCode({ userId: userIds.inactive, request: await request() })).rejects.toMatchObject({ code: 'access_denied' });
    await expect(createAuthorizationCode({ userId: 'gibt-es-nicht', request: await request() })).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('lehnt einen Umfang ab, den die eigene Stufe nicht hergibt', async () => {
    await expect(createAuthorizationCode({ userId: userIds.read, request: await request('mcp:write') })).rejects.toMatchObject({ code: 'invalid_scope' });
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/oauth/service.db.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/oauth/service.ts`:

```ts
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
```

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/oauth/service.db.test.ts` → PASS (10 Tests).

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/oauth/service.ts src/lib/mcp/oauth/service.db.test.ts
git commit -m "feat: OAuth-Service - Client-Registrierung, Autorisierungsanfrage und Code"
```

---

### Task 5: Service — Token einlösen, Refresh mit Rotation, Widerruf

**Files:**
- Modify: `src/lib/mcp/oauth/service.ts`
- Test: `src/lib/mcp/oauth/tokens.db.test.ts`

**Interfaces:**
- Consumes: alles aus Task 4, `verifyPkceS256`, `scopeLevel` nicht nötig.
- Produces:
  - `type TokenResponse = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }`
  - `exchangeAuthorizationCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<TokenResponse>`
  - `refreshAccessToken(input: { refreshToken: string; clientId: string }): Promise<TokenResponse>`
  - `revokeToken(input: { token: string; clientId?: string }): Promise<void>` (Access- oder Refresh-Token; unbekannte Werte werden ignoriert)
  - `revokeTokensOfUser(userId: string, oauthClientId?: string): Promise<number>` (Anzahl widerrufener Token)

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/oauth/tokens.db.test.ts`:

```ts
import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { hashSecret } from './secrets';
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
  revokeToken,
  revokeTokensOfUser,
  validateAuthorizeRequest,
} from './service';

const RUN = `oauth-tok-${Date.now()}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'p'.repeat(60);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

let orgId: string;
let userId: string;
let client: { clientId: string };
let otherClient: { clientId: string };

beforeAll(async () => {
  orgId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Tok', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'WRITE' },
  });
  userId = user.id;
  client = await registerClient({ clientName: `${RUN}-a`, redirectUris: [REDIRECT] });
  otherClient = await registerClient({ clientName: `${RUN}-b`, redirectUris: [REDIRECT] });
});

afterAll(async () => {
  await prisma.oauthToken.deleteMany({ where: { userId } });
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

async function newCode(scope = '', forClient = client.clientId): Promise<string> {
  const validated = await validateAuthorizeRequest({
    response_type: 'code',
    client_id: forClient,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope,
  });
  if (!validated.ok) throw new Error('Testanfrage ungültig');
  return (await createAuthorizationCode({ userId, request: validated.request })).code;
}

const exchangeInput = (code: string, overrides: Partial<{ clientId: string; redirectUri: string; codeVerifier: string }> = {}) => ({
  code,
  clientId: client.clientId,
  redirectUri: REDIRECT,
  codeVerifier: verifier,
  ...overrides,
});

describe('exchangeAuthorizationCode', () => {
  it('tauscht den Code gegen Token, speichert nur Hashes und markiert den Code als benutzt', async () => {
    const code = await newCode();
    const tokens = await exchangeAuthorizationCode(exchangeInput(code));
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe('mcp:read mcp:write');
    const row = await prisma.oauthToken.findUniqueOrThrow({ where: { accessTokenHash: hashSecret(tokens.access_token) } });
    expect(row.refreshTokenHash).toBe(hashSecret(tokens.refresh_token));
    expect(row.userId).toBe(userId);
    expect(row.revokedAt).toBeNull();
    const refreshTtl = row.refreshExpiresAt.getTime() - row.createdAt.getTime();
    expect(refreshTtl).toBeGreaterThan(29 * 24 * 3600 * 1000);
  });

  it('löst einen Code nur einmal ein', async () => {
    const code = await newCode();
    await exchangeAuthorizationCode(exchangeInput(code));
    await expect(exchangeAuthorizationCode(exchangeInput(code))).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('lehnt falschen Verifier, falsche Rücksprungadresse und fremden Client ab, ohne den Code zu verbrauchen', async () => {
    const code = await newCode();
    await expect(exchangeAuthorizationCode(exchangeInput(code, { codeVerifier: 'x'.repeat(60) }))).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchangeAuthorizationCode(exchangeInput(code, { redirectUri: 'https://claude.ai/anders' }))).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchangeAuthorizationCode(exchangeInput(code, { clientId: otherClient.clientId }))).rejects.toMatchObject({ code: 'invalid_grant' });
    // Der Code ist weiterhin einlösbar - Fehlversuche verbrennen ihn nicht (und erlauben kein Raten des Verifiers).
    await expect(exchangeAuthorizationCode(exchangeInput(code))).resolves.toHaveProperty('access_token');
  });

  it('lehnt einen abgelaufenen Code ab', async () => {
    const code = await newCode();
    await prisma.oauthAuthorizationCode.updateMany({ where: { codeHash: hashSecret(code) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(exchangeAuthorizationCode(exchangeInput(code))).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('lehnt ab, wenn der Benutzer inzwischen keinen Zugriff mehr hat', async () => {
    const code = await newCode();
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'NONE' } });
    await expect(exchangeAuthorizationCode(exchangeInput(code))).rejects.toMatchObject({ code: 'invalid_grant' });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE' } });
  });
});

describe('refreshAccessToken', () => {
  async function freshTokens() {
    return exchangeAuthorizationCode(exchangeInput(await newCode()));
  }

  it('rotiert: neuer Satz Token, alter Refresh-Token ist danach widerrufen', async () => {
    const first = await freshTokens();
    const second = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const old = await prisma.oauthToken.findUniqueOrThrow({ where: { refreshTokenHash: hashSecret(first.refresh_token) } });
    expect(old.revokedAt).not.toBeNull();
  });

  it('Wiederverwendung eines ersetzten Refresh-Tokens widerruft die ganze Kette', async () => {
    const first = await freshTokens();
    const second = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    const newest = await prisma.oauthToken.findUniqueOrThrow({ where: { accessTokenHash: hashSecret(second.access_token) } });
    expect(newest.revokedAt).not.toBeNull();
  });

  it('lehnt fremden Client, unbekannten und abgelaufenen Refresh-Token ab', async () => {
    const first = await freshTokens();
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: otherClient.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(refreshAccessToken({ refreshToken: 'unbekannt', clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    await prisma.oauthToken.updateMany({ where: { refreshTokenHash: hashSecret(first.refresh_token) }, data: { refreshExpiresAt: new Date(Date.now() - 1000) } });
    await expect(refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('schneidet den Umfang auf die aktuelle Stufe zu und verweigert bei NONE', async () => {
    const first = await freshTokens();
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'READ' } });
    const downgraded = await refreshAccessToken({ refreshToken: first.refresh_token, clientId: client.clientId });
    expect(downgraded.scope).toBe('mcp:read');
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'NONE' } });
    await expect(refreshAccessToken({ refreshToken: downgraded.refresh_token, clientId: client.clientId })).rejects.toMatchObject({ code: 'invalid_grant' });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE' } });
  });
});

describe('revokeToken / revokeTokensOfUser', () => {
  it('widerruft per Access- oder Refresh-Token und ignoriert unbekannte Werte', async () => {
    const a = await exchangeAuthorizationCode(exchangeInput(await newCode()));
    const b = await exchangeAuthorizationCode(exchangeInput(await newCode()));
    await revokeToken({ token: a.access_token });
    await revokeToken({ token: b.refresh_token });
    await revokeToken({ token: 'unbekannt' });
    const rows = await prisma.oauthToken.findMany({ where: { accessTokenHash: { in: [hashSecret(a.access_token), hashSecret(b.access_token)] } } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('revokeTokensOfUser widerruft alle noch gültigen Token und nennt die Anzahl', async () => {
    await exchangeAuthorizationCode(exchangeInput(await newCode()));
    await exchangeAuthorizationCode(exchangeInput(await newCode()));
    const count = await revokeTokensOfUser(userId);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(await prisma.oauthToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/oauth/tokens.db.test.ts` → FAIL (Exporte fehlen).

- [ ] **Step 3: Implementieren**

In `src/lib/mcp/oauth/service.ts` den Import `import { hashSecret, isValidCodeChallenge, randomSecret } from './secrets';` ändern in:

```ts
import { hashSecret, isValidCodeChallenge, randomSecret, verifyPkceS256 } from './secrets';
```

und am Dateiende anfügen:

```ts
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
```

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/oauth` → PASS (Task 4: 10 Tests, Task 5: 11 Tests).

- [ ] **Step 5: Typprüfung** — Run: `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 6: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/oauth/service.ts src/lib/mcp/oauth/tokens.db.test.ts
git commit -m "feat: OAuth-Service - Code einlösen, Refresh mit Rotation, Widerruf"
```

---

### Task 6: Endpunkte `/oauth/register`, `/oauth/token`, `/oauth/revoke`

**Files:**
- Create: `src/app/oauth/register/route.ts`, `src/app/oauth/token/route.ts`, `src/app/oauth/revoke/route.ts`

**Interfaces:**
- Consumes: `isMcpEnabled`, `checkRateLimit`, `getClientIp` (`src/lib/auth/client-ip.ts`), `registerClient`, `exchangeAuthorizationCode`, `refreshAccessToken`, `revokeToken`, `OauthError`, HTTP-Helfer.

Die Routen sind bewusst dünn (Logik und Tests liegen im Service); ihre Prüfung erfolgt manuell mit `curl` (Step 5).

- [ ] **Step 1: Registrierung**

Create `src/app/oauth/register/route.ts`:

```ts
import { getClientIp } from '@/lib/auth/client-ip';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { jsonResponse, notFoundResponse, oauthErrorResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { registerClient } from '@/lib/mcp/oauth/service';
import { checkRateLimit } from '@/lib/mcp/rate-limit';

export function OPTIONS() {
  return optionsResponse();
}

/** Dynamic Client Registration (RFC 7591): JSON {client_name, redirect_uris[]} -> 201 mit client_id. */
export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return notFoundResponse();
  const ip = await getClientIp();
  if (!checkRateLimit(`oauth-register:${ip}`, 20, 60 * 60 * 1000).allowed) {
    return oauthErrorResponse(new OauthError('invalid_request', 'Zu viele Registrierungen, bitte später erneut versuchen.', 429));
  }

  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(new OauthError('invalid_client_metadata', 'Der Body muss JSON sein.'));
  }

  try {
    const client = await registerClient({ clientName: body.client_name, redirectUris: body.redirect_uris });
    return jsonResponse(
      {
        client_id: client.clientId,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      201,
    );
  } catch (error) {
    if (error instanceof OauthError) return oauthErrorResponse(error);
    console.error('OAuth-Registrierung fehlgeschlagen:', error);
    return oauthErrorResponse(new OauthError('server_error', 'Interner Fehler.', 500));
  }
}
```

- [ ] **Step 2: Token-Endpunkt**

Create `src/app/oauth/token/route.ts`:

```ts
import { getClientIp } from '@/lib/auth/client-ip';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { jsonResponse, notFoundResponse, oauthErrorResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { exchangeAuthorizationCode, refreshAccessToken } from '@/lib/mcp/oauth/service';
import { checkRateLimit } from '@/lib/mcp/rate-limit';

export function OPTIONS() {
  return optionsResponse();
}

/** Token-Endpunkt (RFC 6749 §3.2), Body application/x-www-form-urlencoded. */
export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return notFoundResponse();
  const ip = await getClientIp();
  if (!checkRateLimit(`oauth-token:${ip}`, 60, 60_000).allowed) {
    return oauthErrorResponse(new OauthError('invalid_request', 'Zu viele Anfragen.', 429));
  }

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
```

- [ ] **Step 3: Widerruf**

Create `src/app/oauth/revoke/route.ts`:

```ts
import { getClientIp } from '@/lib/auth/client-ip';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { jsonResponse, notFoundResponse, oauthErrorResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { revokeToken } from '@/lib/mcp/oauth/service';
import { checkRateLimit } from '@/lib/mcp/rate-limit';

export function OPTIONS() {
  return optionsResponse();
}

/** RFC 7009: antwortet immer 200, auch bei unbekanntem Token (verrät nicht, ob es existiert). */
export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return notFoundResponse();
  const ip = await getClientIp();
  if (!checkRateLimit(`oauth-revoke:${ip}`, 60, 60_000).allowed) {
    return oauthErrorResponse(new OauthError('invalid_request', 'Zu viele Anfragen.', 429));
  }
  const params = new URLSearchParams(await request.text());
  const token = params.get('token');
  if (token) await revokeToken({ token, clientId: params.get('client_id') ?? undefined });
  return jsonResponse({});
}
```

- [ ] **Step 4: Typprüfung und Build**

Run: `npx tsc --noEmit` → keine Fehler. Run: `npm run build` → die drei `/oauth/*`-Routen stehen in der Liste.

- [ ] **Step 5: Manuelle Prüfung gegen den lokalen Dev-Server**

Dev-Server starten (`npm run dev`), im Browser als Bezirksadmin unter `/admin/mcp` den Connector einschalten. Dann in einer zweiten Shell (ersetzt `3000` falls abweichend):

```bash
curl -s http://localhost:3000/.well-known/oauth-authorization-server
curl -s -X POST http://localhost:3000/oauth/register -H "Content-Type: application/json" -d '{"client_name":"Test","redirect_uris":["http://localhost:6274/callback"]}'
curl -s -X POST http://localhost:3000/oauth/register -H "Content-Type: application/json" -d '{"client_name":"Böse","redirect_uris":["https://evil.example/cb"]}'
curl -s -X POST http://localhost:3000/oauth/token -d "grant_type=authorization_code&code=x&client_id=y&redirect_uri=z&code_verifier=v"
```

Erwartung: (1) JSON mit `issuer` und `code_challenge_methods_supported:["S256"]`; (2) JSON mit `client_id` beginnend `mcp_`; (3) `{"error":"invalid_redirect_uri",...}`; (4) `{"error":"invalid_grant",...}`. Connector ausschalten → alle vier Aufrufe liefern 404.

- [ ] **Step 6: Commit (nur auf Anweisung)**

```bash
git add src/app/oauth
git commit -m "feat: OAuth-Endpunkte register, token und revoke"
```

---

### Task 7: Anmelde- und Zustimmungsseite

**Files:**
- Create: `src/lib/auth/callback-url.ts`, `src/app/oauth/authorize/page.tsx`, `src/app/oauth/authorize/actions.ts`
- Modify: `src/middleware.ts`
- Test: `src/lib/auth/callback-url.test.ts`

**Interfaces:**
- Consumes: `validateAuthorizeRequest`, `createAuthorizationCode`, `buildRedirect`, `grantedScope`, `getMcpAccessOf`, `isMcpEnabled`, `OauthError`, `requireUser`.
- Produces: `buildLoginCallbackUrl(pathname: string, search: string): string`.

**Bekannte Einschränkung (so dokumentieren, nicht lösen):** Die Anmeldung per E-Mail-Token (Link/Code) kehrt nicht zu `/oauth/authorize` zurück. Wer so angemeldet ist, startet die Verbindung in Claude/ChatGPT einfach erneut; die Sitzung besteht dann bereits und er landet direkt bei der Zustimmung.

- [ ] **Step 1: Failing Test**

Create `src/lib/auth/callback-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildLoginCallbackUrl } from './callback-url';

describe('buildLoginCallbackUrl', () => {
  it('erhält für /oauth/authorize die Query (sonst gingen die OAuth-Parameter beim Login verloren)', () => {
    expect(buildLoginCallbackUrl('/oauth/authorize', '?client_id=a&state=b')).toBe('/oauth/authorize?client_id=a&state=b');
  });

  it('lässt alle anderen Pfade unverändert beim reinen Pfad', () => {
    expect(buildLoginCallbackUrl('/kalender', '?x=1')).toBe('/kalender');
    expect(buildLoginCallbackUrl('/oauth/authorize/andere', '?x=1')).toBe('/oauth/authorize/andere');
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/auth/callback-url.test.ts` → FAIL.

- [ ] **Step 3: Implementieren und in die Middleware einhängen**

Create `src/lib/auth/callback-url.ts`:

```ts
/**
 * callbackUrl für die Login-Weiterleitung der Middleware. Normalerweise nur der Pfad (bisheriges Verhalten); für
 * /oauth/authorize zusätzlich die Query - ohne die gingen client_id, redirect_uri, code_challenge und state beim
 * Login verloren, und die Zustimmung wäre nach der Anmeldung nicht mehr möglich.
 */
export function buildLoginCallbackUrl(pathname: string, search: string): string {
  return pathname === '/oauth/authorize' ? pathname + search : pathname;
}
```

In `src/middleware.ts` oben `import { buildLoginCallbackUrl } from '@/lib/auth/callback-url';` ergänzen und die Zeile

```ts
    loginUrl.searchParams.set('callbackUrl', pathname);
```

ersetzen durch:

```ts
    loginUrl.searchParams.set('callbackUrl', buildLoginCallbackUrl(pathname, req.nextUrl.search));
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/auth/callback-url.test.ts` → PASS (2 Tests).

- [ ] **Step 5: Server Actions**

Create `src/app/oauth/authorize/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { buildRedirect } from '@/lib/mcp/oauth/redirect-uris';
import { createAuthorizationCode, validateAuthorizeRequest } from '@/lib/mcp/oauth/service';

const PARAM_NAMES = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state'] as const;

function readParams(formData: FormData): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  for (const name of PARAM_NAMES) {
    const value = formData.get(name);
    params[name] = typeof value === 'string' && value !== '' ? value : undefined;
  }
  return params;
}

/** Die versteckten Formularfelder werden nie vertraut: alles wird hier erneut geprüft. */
async function validated(formData: FormData) {
  if (!(await isMcpEnabled())) throw new Error('Nicht verfügbar.');
  const result = await validateAuthorizeRequest(readParams(formData));
  if (!result.ok) {
    if (result.fatal) throw new Error(result.message);
    redirect(buildRedirect(result.redirectUri, { error: result.error, error_description: result.errorDescription, state: result.state }));
  }
  return result.request;
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const user = await requireUser();
  const request = await validated(formData);
  let code: string;
  try {
    ({ code } = await createAuthorizationCode({ userId: user.id, request }));
  } catch (error) {
    if (error instanceof OauthError) {
      redirect(buildRedirect(request.redirectUri, { error: error.code, error_description: error.message, state: request.state }));
    }
    throw error;
  }
  redirect(buildRedirect(request.redirectUri, { code, state: request.state }));
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  await requireUser();
  const request = await validated(formData);
  redirect(buildRedirect(request.redirectUri, { error: 'access_denied', error_description: 'Der Benutzer hat den Zugriff abgelehnt.', state: request.state }));
}
```

- [ ] **Step 6: Seite**

Create `src/app/oauth/authorize/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getMcpAccessOf } from '@/lib/mcp/access-db';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { buildRedirect } from '@/lib/mcp/oauth/redirect-uris';
import { grantedScope } from '@/lib/mcp/oauth/scopes';
import { validateAuthorizeRequest } from '@/lib/mcp/oauth/service';
import { approveAuthorization, denyAuthorization } from './actions';

const PARAM_NAMES = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state'] as const;

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-2 text-xl font-semibold text-neutral-900">{title}</h1>
        <p className="text-sm text-neutral-600">{message}</p>
      </div>
    </div>
  );
}

// Immer dynamisch: hängt vom Funktionsschalter, von der Sitzung und den Query-Parametern ab.
export const dynamic = 'force-dynamic';

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await isMcpEnabled())) notFound();
  const user = await requireUser();

  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const name of PARAM_NAMES) {
    const value = raw[name];
    params[name] = Array.isArray(value) ? value[0] : value;
  }

  const result = await validateAuthorizeRequest(params);
  if (!result.ok) {
    if (result.fatal) return <ErrorCard title="Anmeldung nicht möglich" message={result.message} />;
    redirect(buildRedirect(result.redirectUri, { error: result.error, error_description: result.errorDescription, state: result.state }));
  }

  const access = await getMcpAccessOf(user.id);
  const scope = grantedScope(result.request.scope, access);
  if (access === 'NONE') {
    return (
      <ErrorCard
        title="Kein Zugriff"
        message="Dein Konto hat keinen Zugriff auf den KI-Connector. Bitte wende dich an einen Admin deiner Feuerwehr."
      />
    );
  }
  if (!scope) {
    return <ErrorCard title="Umfang nicht erlaubt" message="Die Anwendung verlangt mehr Rechte, als dein Konto hat." />;
  }

  const canWrite = scope.split(' ').includes('mcp:write');
  const hidden = PARAM_NAMES.map((name) => (params[name] ? <input key={name} type="hidden" name={name} value={params[name]} /> : null));

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Zugriff erlauben?</h1>
        <p className="mb-4 text-sm text-neutral-600">
          <strong>{result.request.clientName}</strong> möchte sich im Namen von <strong>{user.name}</strong> mit der Feuerwehr-App
          verbinden.
        </p>
        <ul className="mb-4 list-disc pl-5 text-sm text-neutral-700">
          <li>Daten abfragen, die du auch in der App sehen darfst (Benutzer, Drohnengruppe, Kalender, Atemschutz)</li>
          {canWrite && <li>Neue Benutzer anlegen, soweit du das in der App darfst</li>}
        </ul>
        <p className="mb-6 text-xs text-neutral-500">Du kannst die Verbindung jederzeit in deinem Profil unter "Verbundene KI-Apps" beenden.</p>
        <div className="flex gap-3">
          <form action={approveAuthorization} className="flex-1">
            {hidden}
            <button type="submit" className="min-h-11 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
              Erlauben
            </button>
          </form>
          <form action={denyAuthorization} className="flex-1">
            {hidden}
            <button type="submit" className="min-h-11 w-full rounded-md border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink">
              Ablehnen
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Typprüfung und Build** — `npx tsc --noEmit` und `npm run build` → beide ohne Fehler; Route `/oauth/authorize` erscheint als dynamisch.

- [ ] **Step 8: Manuelle Prüfung des Ablaufs (lokal)**

Connector eingeschaltet, ein Benutzer mit `mcpAccess = READ` (in der Benutzerverwaltung vergeben). Client registrieren (Aufruf 2 aus Task 6 Step 5, `client_id` merken) und im Browser, **ausgeloggt**, öffnen (Challenge ist das RFC-Beispiel):

`http://localhost:3000/oauth/authorize?response_type=code&client_id=<client_id>&redirect_uri=http%3A%2F%2Flocalhost%3A6274%2Fcallback&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=abc`

Erwartung: Weiterleitung zur Anmeldung, nach dem Login (Passwort) zurück auf `/oauth/authorize` **mit** allen Parametern, Zustimmungskarte zeigt "Test" und nur "Daten abfragen". "Erlauben" leitet auf `http://localhost:6274/callback?code=...&state=abc` (die Seite lädt nicht, die Adresszeile genügt). Mit dem Code:

```bash
curl -s -X POST http://localhost:3000/oauth/token -d "grant_type=authorization_code&code=<code>&client_id=<client_id>&redirect_uri=http%3A%2F%2Flocalhost%3A6274%2Fcallback&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

Erwartung: JSON mit `access_token`, `refresh_token`, `scope:"mcp:read"`. Derselbe Aufruf ein zweites Mal: `invalid_grant`. Ein Benutzer mit `NONE` sieht "Kein Zugriff". Mit einer unbekannten `client_id` zeigt die Seite die Fehlerseite statt zu leiten.

- [ ] **Step 9: Commit (nur auf Anweisung)**

```bash
git add src/lib/auth/callback-url.ts src/lib/auth/callback-url.test.ts src/app/oauth/authorize src/middleware.ts
git commit -m "feat: OAuth-Anmelde- und Zustimmungsseite für den MCP-Connector"
```

---

### Task 8: Gesamtprüfung Phase 2

- [ ] **Step 1:** `npm test` → alle Unit-Tests grün (neu: 6 + 10 + 4 + 2 = 22).
- [ ] **Step 2:** `npm run test:db` → alle DB-Tests grün (neu: 10 + 11 = 21).
- [ ] **Step 3:** `npx tsc --noEmit` und `npm run build` → ohne Fehler.
- [ ] **Step 4:** Connector in `/admin/mcp` ausschalten, `curl http://localhost:3000/oauth/token -X POST` → 404; `/oauth/authorize?...` → 404-Seite.

## Phase-2-Abnahme

- Ein Client registriert sich (nur erlaubte Rücksprungadressen), der Benutzer meldet sich mit dem App-Login an und erlaubt den Zugriff, der Client erhält Access- und Refresh-Token.
- Code einmalig, PKCE Pflicht, Refresh rotiert, Wiederverwendung widerruft die Kette, Entzug von `mcpAccess` wirkt beim nächsten Einlösen/Refresh.
- Ausgeschaltet antwortet alles mit 404. Es gibt noch keinen `/api/mcp`-Endpunkt (Phase 3).
