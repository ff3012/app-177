# MCP-Connector · Phase 3: MCP-Endpunkt und Lesewerkzeuge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Endpunkt `/api/mcp` (MCP über Streamable HTTP) mit Token-Prüfung und den sieben Lesewerkzeugen `list_users`, `get_user`, `get_atemschutz_status`, `list_drone_flights`, `get_drone_readiness`, `list_calendar_events`, `list_organizations`, `list_dienstgrade`. Ab dieser Phase kann ein Benutzer mit `READ` in Claude/ChatGPT Daten abfragen.

**Architecture:** `authenticateBearer` macht aus dem Bearer-Token ein `McpPrincipal` (live geladener Benutzer → `buildSessionUser`, Stufe = Token-Umfang ∩ `mcpAccess`). Jedes Werkzeug ist eine reine Funktion `(ctx, input) => Promise<ToolResult>` in `src/lib/mcp/tools/` und ruft die **bestehenden** Rechtefunktionen mit `ctx.principal.user` auf; dadurch lassen sich alle Rechte ohne MCP-Transport testen. `runTool` kapselt Mengenbegrenzung, Fehlerabbildung und Prüfprotokoll. Der Route Handler baut je Anfrage einen zustandslosen `McpServer` mit dem Web-Standard-Transport des SDK.

**Tech Stack:** `@modelcontextprotocol/sdk` 1.32.2 (`McpServer`, `WebStandardStreamableHTTPServerTransport`), zod ≥ 3.25, Prisma, vitest.

**Voraussetzung:** Phasen 1 und 2 sind umgesetzt (`McpAccessLevel`, `hasMcpAccess`, `isMcpEnabled`, `recordMcpAudit`, `checkRateLimit`, OAuth-Service mit `registerClient`, `validateAuthorizeRequest`, `createAuthorizationCode`, `exchangeAuthorizationCode`, `scopeLevel`, `hashSecret`, `getIssuer`, `CORS_HEADERS`).

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-connector-design.md`

## Global Constraints

- **Datenumfang wie in der App:** Jedes Werkzeug nutzt die bestehenden Rechtefunktionen (`canAccessUserManagementAdmin`, `canManageUsersFor`, `canManageHeimatfeuerwehrFor`, `canViewDroneModule`, `getAllowedDroneGroups`, `canViewEvent`) mit dem `SessionUser` des Token-Inhabers. Wo ein Zugriff nicht erlaubt ist, antwortet ein Werkzeug mit "nicht gefunden" bzw. einer klaren Ablehnung, nie mit Daten.
- **Nie ausgeben:** Passwort-Hashes, Token, Aktivierungslinks, `icsToken`, Google-/Facebook-Zugangsdaten.
- **Listen:** höchstens 50 Einträge pro Aufruf, `cursor` für die nächste Seite. Freitexte (Termin-Beschreibung) nur auf ausdrücklichen Wunsch (`includeDescription`).
- **Mengenbegrenzung:** 120 Aufrufe pro Minute und Token. Mengenbegrenzung und Fehler werden als MCP-Werkzeugfehler (`isError: true`) mit deutscher Meldung zurückgegeben, nie als Stacktrace.
- **Prüfprotokoll:** alle abgelehnten Zugriffe und alle Schreibaktionen (Schreibwerkzeuge folgen in Phase 4).
- **Token-Prüfung bei jeder Anfrage live:** Token gültig (nicht abgelaufen/widerrufen), Benutzer aktiv, Stufe = Token-Umfang ∩ aktuelles `mcpAccess`; Stufe `NONE` → 403.
- **Funktionsschalter:** `isMcpEnabled()` aus → `/api/mcp` antwortet 404.
- **`WWW-Authenticate`** bei 401: `Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource/api/mcp"`.
- **Ausgabe auf Deutsch** (Schlüssel und Texte), Bezeichner der Werkzeuge englisch (`snake_case`).
- Übrige Konventionen wie in den Phasen 1 und 2 (CRLF, Tests, Commits nur auf Anweisung).

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/lib/mcp/auth.ts` | `authenticateBearer`, `McpPrincipal` |
| `src/lib/mcp/test-support-db.ts` | `issueTestToken` für DB-Tests |
| `src/lib/mcp/tools/context.ts` | `ToolError`, `denied`, `ToolContext`, `ToolResult`, Seitenlogik |
| `src/lib/mcp/tools/define.ts` | `defineTool`, `ToolDefinition` |
| `src/lib/mcp/tools/run.ts` | `runTool` (Mengenbegrenzung, Fehlerabbildung, Prüfprotokoll) |
| `src/lib/mcp/tools/test-support.ts` | `sessionUserFixture`, `principalFixture` |
| `src/lib/mcp/tools/reference.ts` | `list_organizations`, `list_dienstgrade` |
| `src/lib/mcp/tools/users.ts` | `list_users`, `get_user` |
| `src/lib/mcp/tools/atemschutz.ts` | `get_atemschutz_status` |
| `src/lib/mcp/tools/drone.ts` | `list_drone_flights`, `get_drone_readiness` |
| `src/lib/mcp/tools/calendar.ts` | `list_calendar_events` |
| `src/lib/mcp/tools/index.ts` | `TOOLS` (Registrierung) |
| `src/lib/mcp/server.ts` | `createMcpServer(principal)` |
| `src/app/api/mcp/route.ts` | Endpunkt |

---

### Task 1: SDK installieren und `authenticateBearer`

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/lib/mcp/auth.ts`, `src/lib/mcp/test-support-db.ts`
- Test: `src/lib/mcp/auth.db.test.ts`

**Interfaces:**
- Produces:
  - `interface McpPrincipal { user: SessionUser; access: McpAccessLevel; clientId: string; clientName: string; tokenId: string }`
  - `type McpAuthResult = { ok: true; principal: McpPrincipal } | { ok: false; status: 401 | 403; error: 'invalid_token' | 'insufficient_scope' }`
  - `authenticateBearer(authorization: string | null, now?: Date): Promise<McpAuthResult>`
  - `issueTestToken(input: { userId: string; namePrefix: string; scope?: string }): Promise<{ accessToken: string; refreshToken: string }>`

- [ ] **Step 1: Abhängigkeiten installieren**

Das SDK verlangt `zod` ≥ 3.25 (das Projekt hat `^3.24.1`):

```bash
npm install @modelcontextprotocol/sdk@1.32.2 zod@^3.25.0
```

Danach `npx tsc --noEmit` und `npm test` laufen lassen — beides muss weiterhin grün sein (das zod-Update ist ein Minor-Update). Wird etwas rot, zuerst diese Ursache beheben, bevor weitergemacht wird.

- [ ] **Step 2: Test-Hilfe für Token schreiben**

Create `src/lib/mcp/test-support-db.ts`:

```ts
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
```

- [ ] **Step 3: Failing DB-Test**

Create `src/lib/mcp/auth.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { authenticateBearer } from './auth';
import { hashSecret } from './oauth/secrets';
import { issueTestToken } from './test-support-db';

const RUN = `mcp-auth-${Date.now()}`;
let orgId: string;
let userId: string;

beforeAll(async () => {
  orgId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Auth', lastName: RUN, homeOrganizationId: orgId, mcpAccess: 'WRITE' },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.oauthToken.deleteMany({ where: { userId } });
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const bearer = (token: string) => `Bearer ${token}`;

describe('authenticateBearer', () => {
  it('liefert Benutzer, Stufe und Client für ein gültiges Token', async () => {
    const { accessToken } = await issueTestToken({ userId, namePrefix: `${RUN}-ok` });
    const result = await authenticateBearer(bearer(accessToken));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.user.id).toBe(userId);
      expect(result.principal.user.name).toBe(`Auth ${RUN}`);
      expect(result.principal.access).toBe('WRITE');
      expect(result.principal.clientName).toBe(`${RUN}-ok-client`);
    }
  });

  it('lehnt fehlenden, falsch geformten und unbekannten Header ab (401)', async () => {
    for (const header of [null, '', 'Basic abc', 'Bearer', 'Bearer   ', 'Bearer unbekannt']) {
      expect(await authenticateBearer(header)).toEqual({ ok: false, status: 401, error: 'invalid_token' });
    }
  });

  it('lehnt widerrufene und abgelaufene Token ab (401)', async () => {
    const revoked = await issueTestToken({ userId, namePrefix: `${RUN}-rev` });
    await prisma.oauthToken.updateMany({ where: { accessTokenHash: hashSecret(revoked.accessToken) }, data: { revokedAt: new Date() } });
    expect(await authenticateBearer(bearer(revoked.accessToken))).toMatchObject({ ok: false, status: 401 });

    const expired = await issueTestToken({ userId, namePrefix: `${RUN}-exp` });
    await prisma.oauthToken.updateMany({ where: { accessTokenHash: hashSecret(expired.accessToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await authenticateBearer(bearer(expired.accessToken))).toMatchObject({ ok: false, status: 401 });
  });

  it('schneidet die Stufe auf Token-Umfang und aktuelles mcpAccess zu', async () => {
    const readOnly = await issueTestToken({ userId, namePrefix: `${RUN}-ro`, scope: 'mcp:read' });
    const readResult = await authenticateBearer(bearer(readOnly.accessToken));
    expect(readResult.ok && readResult.principal.access).toBe('READ');

    const full = await issueTestToken({ userId, namePrefix: `${RUN}-full` });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'READ' } });
    const downgraded = await authenticateBearer(bearer(full.accessToken));
    expect(downgraded.ok && downgraded.principal.access).toBe('READ');
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE' } });
  });

  it('verweigert (403), wenn das Recht inzwischen entzogen wurde, und lehnt deaktivierte Benutzer ab (401)', async () => {
    const { accessToken } = await issueTestToken({ userId, namePrefix: `${RUN}-lost` });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'NONE' } });
    expect(await authenticateBearer(bearer(accessToken))).toEqual({ ok: false, status: 403, error: 'insufficient_scope' });
    await prisma.user.update({ where: { id: userId }, data: { mcpAccess: 'WRITE', isActive: false } });
    expect(await authenticateBearer(bearer(accessToken))).toEqual({ ok: false, status: 401, error: 'invalid_token' });
    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});
```

- [ ] **Step 4: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/auth.db.test.ts` → FAIL (Modul `./auth` fehlt).

- [ ] **Step 5: Implementieren**

Create `src/lib/mcp/auth.ts`:

```ts
import { buildSessionUser, findUserWithRelationsById } from '@/lib/auth/build-session-user';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import { mcpRank, type McpAccessLevel } from './access';
import { scopeLevel } from './oauth/scopes';
import { hashSecret } from './oauth/secrets';

export interface McpPrincipal {
  user: SessionUser;
  access: McpAccessLevel;
  clientId: string;
  clientName: string;
  tokenId: string;
}

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; status: 401 | 403; error: 'invalid_token' | 'insufficient_scope' };

const INVALID: McpAuthResult = { ok: false, status: 401, error: 'invalid_token' };
const LAST_USED_THROTTLE_MS = 60_000;

const lower = (a: McpAccessLevel, b: McpAccessLevel): McpAccessLevel => (mcpRank(a) <= mcpRank(b) ? a : b);

/**
 * Prüft das Bearer-Token einer MCP-Anfrage und baut den Benutzer LIVE aus der Datenbank (derselbe Weg wie der jwt()-
 * Callback in auth.config.ts). Stufe = Token-Umfang ∩ aktuelles mcpAccess - Rechteentzug, Deaktivierung und
 * Widerruf wirken dadurch bei der nächsten Anfrage.
 */
export async function authenticateBearer(authorization: string | null, now: Date = new Date()): Promise<McpAuthResult> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  if (!match) return INVALID;

  const token = await prisma.oauthToken.findUnique({
    where: { accessTokenHash: hashSecret(match[1]) },
    include: { oauthClient: true },
  });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= now.getTime()) return INVALID;

  const dbUser = await findUserWithRelationsById(token.userId);
  if (!dbUser || !dbUser.isActive) return INVALID;

  const access = lower(scopeLevel(token.scope), dbUser.mcpAccess);
  if (access === 'NONE') return { ok: false, status: 403, error: 'insufficient_scope' };

  // Best-effort und gedrosselt (höchstens 1x/Minute je Token) - die Anzeige "zuletzt benutzt" ist nicht kritisch.
  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    prisma.oauthToken.update({ where: { id: token.id }, data: { lastUsedAt: now } }).catch((error) => {
      console.error('lastUsedAt des OAuth-Tokens konnte nicht aktualisiert werden:', error);
    });
  }

  return {
    ok: true,
    principal: {
      user: await buildSessionUser(dbUser),
      access,
      clientId: token.oauthClient.clientId,
      clientName: token.oauthClient.name,
      tokenId: token.id,
    },
  };
}
```

- [ ] **Step 6: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/auth.db.test.ts` → PASS (5 Tests). `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 7: Commit (nur auf Anweisung)**

```bash
git add package.json package-lock.json src/lib/mcp/auth.ts src/lib/mcp/auth.db.test.ts src/lib/mcp/test-support-db.ts
git commit -m "feat: MCP-Token-Prüfung (authenticateBearer) und SDK-Abhängigkeit"
```

---

### Task 2: Werkzeug-Grundgerüst (Fehler, Seiten, `defineTool`, `runTool`)

**Files:**
- Create: `src/lib/mcp/tools/context.ts`, `src/lib/mcp/tools/define.ts`, `src/lib/mcp/tools/run.ts`, `src/lib/mcp/tools/test-support.ts`
- Test: `src/lib/mcp/tools/context.test.ts`, `src/lib/mcp/tools/run.test.ts`

**Interfaces:**
- Produces:
  - `class ToolError extends Error { kind: 'denied' | 'invalid' }`, `denied(message: string): ToolError`, `invalid(message: string): ToolError`
  - `interface ToolContext { principal: McpPrincipal }`
  - `interface ToolResult { data: unknown; audit?: { targetUserId?: string | null; summary: string } }`
  - `clampLimit(limit: number | undefined): number` (1–50, Standard 25), `encodeCursor(offset: number): string`, `decodeCursor(cursor: string | undefined): number` (ungültig → 0), `toPage<T>(rows: T[], limit: number, offset: number): { items: T[]; nextCursor: string | null }` (`rows` sind bereits mit `take: limit + 1` und `skip: offset` geladen)
  - `interface ToolDefinition { name: string; description: string; access: 'READ' | 'WRITE'; inputSchema: z.ZodRawShape; handler(ctx: ToolContext, input: any): Promise<ToolResult> }`, `defineTool<S extends z.ZodRawShape>(def): ToolDefinition`
  - `RATE_LIMIT_PER_MINUTE = 120`; `runTool(principal: McpPrincipal, tool: ToolDefinition, args: unknown, deps?: { audit?: typeof recordMcpAudit }): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>`
  - `sessionUserFixture(overrides?: Partial<SessionUser>): SessionUser`, `principalFixture(user: SessionUser, access?: McpAccessLevel): McpPrincipal`

- [ ] **Step 1: Failing Test für Seiten und Fehler**

Create `src/lib/mcp/tools/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clampLimit, decodeCursor, denied, encodeCursor, invalid, toPage, ToolError } from './context';

describe('clampLimit', () => {
  it('Standard 25, mindestens 1, höchstens 50', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(500)).toBe(50);
  });
});

describe('Cursor', () => {
  it('trägt den Versatz hin und zurück', () => {
    expect(decodeCursor(encodeCursor(75))).toBe(75);
    expect(decodeCursor(encodeCursor(0))).toBe(0);
  });

  it('behandelt fehlende oder ungültige Cursor als Anfang', () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('###')).toBe(0);
    expect(decodeCursor(Buffer.from('-4').toString('base64url'))).toBe(0);
    expect(decodeCursor(Buffer.from('abc').toString('base64url'))).toBe(0);
  });
});

describe('toPage', () => {
  it('liefert bei Überhang eine Folgeseite und schneidet den Überhang ab', () => {
    expect(toPage([1, 2, 3], 2, 10)).toEqual({ items: [1, 2], nextCursor: encodeCursor(12) });
  });

  it('liefert ohne Überhang keine Folgeseite', () => {
    expect(toPage([1, 2], 2, 0)).toEqual({ items: [1, 2], nextCursor: null });
    expect(toPage([], 25, 0)).toEqual({ items: [], nextCursor: null });
  });
});

describe('ToolError', () => {
  it('unterscheidet Ablehnung und ungültige Eingabe', () => {
    expect(denied('x')).toBeInstanceOf(ToolError);
    expect(denied('x').kind).toBe('denied');
    expect(invalid('y').kind).toBe('invalid');
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/mcp/tools/context.test.ts` → FAIL.

- [ ] **Step 3: `context.ts`, `define.ts`, `test-support.ts` implementieren**

Create `src/lib/mcp/tools/context.ts`:

```ts
import type { McpPrincipal } from '../auth';

/** Fehler, die dem Aufrufer (der KI) als verständliche Meldung zurückgegeben werden. denied = fehlendes Recht. */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly kind: 'denied' | 'invalid' = 'invalid',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
export const denied = (message: string) => new ToolError(message, 'denied');
export const invalid = (message: string) => new ToolError(message, 'invalid');

export interface ToolContext {
  principal: McpPrincipal;
}

/** `audit` gesetzt = der Aufruf kommt ins Prüfprotokoll (Schreibaktionen). */
export interface ToolResult {
  data: unknown;
  audit?: { targetUserId?: string | null; summary: string };
}

const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 50;

export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** `rows` wurden mit take: limit + 1 und skip: offset geladen; ein Überhang bedeutet "es gibt eine Folgeseite". */
export function toPage<T>(rows: T[], limit: number, offset: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, nextCursor: hasMore ? encodeCursor(offset + limit) : null };
}
```

Create `src/lib/mcp/tools/define.ts`:

```ts
import type { z } from 'zod';
import type { ToolContext, ToolResult } from './context';

export interface ToolDefinition {
  name: string;
  description: string;
  /** Mindeststufe: READ-Werkzeuge sehen alle, WRITE-Werkzeuge nur Benutzer mit WRITE. */
  access: 'READ' | 'WRITE';
  inputSchema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: ToolContext, input: any) => Promise<ToolResult>;
}

/** Typisiert den Handler anhand des zod-Schemas; das Ergebnis ist für die Registrierung typgelöscht. */
export function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  access: 'READ' | 'WRITE';
  inputSchema: S;
  handler: (ctx: ToolContext, input: z.infer<z.ZodObject<S>>) => Promise<ToolResult>;
}): ToolDefinition {
  return def as ToolDefinition;
}
```

Create `src/lib/mcp/tools/test-support.ts`:

```ts
import type { SessionUser } from '@/types/next-auth';
import type { McpAccessLevel } from '../access';
import type { McpPrincipal } from '../auth';

/** Nur für Tests: vollständiges SessionUser ohne Rechte, einzelne Felder überschreibbar. */
export function sessionUserFixture(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u-test',
    email: 'u-test@example.local',
    name: 'Test User',
    homeOrganizationId: 'org-test',
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: 'abschnitt-test',
    feuerwehrAdminOrgIds: [],
    abschnittAdminOrgIds: [],
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    isAbschnittskommandoMitglied: false,
    isDrohnengruppeMember: false,
    droneGroupId: null,
    droneGroupRole: null,
    ...overrides,
  };
}

export function principalFixture(user: SessionUser, access: McpAccessLevel = 'READ'): McpPrincipal {
  return { user, access, clientId: 'mcp_test', clientName: 'Test', tokenId: `tok-${Math.random()}` };
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/mcp/tools/context.test.ts` → PASS (7 Tests).

- [ ] **Step 5: Failing Test für `runTool`**

Create `src/lib/mcp/tools/run.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { denied, invalid } from './context';
import { defineTool } from './define';
import { principalFixture, sessionUserFixture } from './test-support';
import { RATE_LIMIT_PER_MINUTE, runTool } from './run';

const readTool = (handler: () => Promise<{ data: unknown; audit?: { summary: string; targetUserId?: string } }>) =>
  defineTool({ name: 'demo_read', description: 'x', access: 'READ', inputSchema: {}, handler });
const writeTool = (handler: () => Promise<{ data: unknown; audit?: { summary: string; targetUserId?: string } }>) =>
  defineTool({ name: 'demo_write', description: 'x', access: 'WRITE', inputSchema: {}, handler });

function setup() {
  const audit = vi.fn(async () => undefined);
  const principal = principalFixture(sessionUserFixture({ id: 'u1' }), 'WRITE');
  return { audit, principal };
}

describe('runTool', () => {
  it('liefert die Daten als JSON-Text und schreibt für reine Lesewerkzeuge kein Protokoll', async () => {
    const { audit, principal } = setup();
    const result = await runTool(principal, readTool(async () => ({ data: { a: 1 } })), {}, { audit });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
    expect(audit).not.toHaveBeenCalled();
  });

  it('protokolliert erfolgreiche Schreibaktionen (OK) mit Ziel und Zusammenfassung', async () => {
    const { audit, principal } = setup();
    await runTool(principal, writeTool(async () => ({ data: {}, audit: { targetUserId: 't1', summary: 'Benutzer angelegt' } })), {}, { audit });
    expect(audit).toHaveBeenCalledWith({
      userId: 'u1',
      clientId: 'mcp_test',
      tool: 'demo_write',
      outcome: 'OK',
      targetUserId: 't1',
      summary: 'Benutzer angelegt',
    });
  });

  it('gibt verweigerte Zugriffe als Fehler zurück und protokolliert DENIED', async () => {
    const { audit, principal } = setup();
    const result = await runTool(principal, readTool(async () => { throw denied('Keine Berechtigung.'); }), {}, { audit });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Keine Berechtigung.');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', tool: 'demo_read', summary: 'Keine Berechtigung.' }));
  });

  it('meldet ungültige Eingaben: bei Lesewerkzeugen ohne, bei Schreibwerkzeugen mit Protokoll (ERROR)', async () => {
    const { audit, principal } = setup();
    const readResult = await runTool(principal, readTool(async () => { throw invalid('Unbekannte Feuerwehr.'); }), {}, { audit });
    expect(readResult).toMatchObject({ isError: true, content: [{ text: 'Unbekannte Feuerwehr.' }] });
    expect(audit).not.toHaveBeenCalled();
    await runTool(principal, writeTool(async () => { throw invalid('E-Mail existiert bereits.'); }), {}, { audit });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ERROR', tool: 'demo_write' }));
  });

  it('gibt bei unerwarteten Fehlern nur eine allgemeine Meldung zurück (kein Stacktrace) und protokolliert ERROR', async () => {
    const { audit, principal } = setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runTool(principal, readTool(async () => { throw new Error('connection refused 10.0.0.5'); }), {}, { audit });
    spy.mockRestore();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('10.0.0.5');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ERROR' }));
  });

  it('begrenzt die Aufrufe je Token pro Minute', async () => {
    const { audit, principal } = setup();
    const tool = readTool(async () => ({ data: 1 }));
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect((await runTool(principal, tool, {}, { audit })).isError).toBeUndefined();
    }
    const blocked = await runTool(principal, tool, {}, { audit });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toMatch(/Zu viele Anfragen/);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', summary: expect.stringContaining('Mengenbegrenzung') }));
  });
});
```

- [ ] **Step 6: Rot** — Run: `npx vitest run src/lib/mcp/tools/run.test.ts` → FAIL (`./run` fehlt).

- [ ] **Step 7: `runTool` implementieren**

Create `src/lib/mcp/tools/run.ts`:

```ts
import { recordMcpAudit } from '../audit';
import type { McpPrincipal } from '../auth';
import { checkRateLimit } from '../rate-limit';
import { ToolError } from './context';
import type { ToolDefinition } from './define';

export const RATE_LIMIT_PER_MINUTE = 120;

interface RunResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const text = (value: string): RunResult['content'] => [{ type: 'text', text: value }];

/**
 * Führt ein Werkzeug aus: Mengenbegrenzung je Token, Fehlerabbildung auf MCP-Werkzeugfehler (deutsch, ohne
 * Stacktrace) und Prüfprotokoll. Protokolliert werden alle abgelehnten Zugriffe (DENIED), alle Schreibaktionen
 * (OK über ToolResult.audit, ERROR bei Fehlern) und alle unerwarteten Fehler.
 */
export async function runTool(
  principal: McpPrincipal,
  tool: ToolDefinition,
  args: unknown,
  deps: { audit?: typeof recordMcpAudit } = {},
): Promise<RunResult> {
  const audit = deps.audit ?? recordMcpAudit;
  const base = { userId: principal.user.id, clientId: principal.clientId, tool: tool.name };

  const limit = checkRateLimit(`mcp:${principal.tokenId}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    await audit({ ...base, outcome: 'DENIED', summary: 'Mengenbegrenzung überschritten' });
    return { isError: true, content: text(`Zu viele Anfragen. Bitte in ${limit.retryAfterSeconds} Sekunden erneut versuchen.`) };
  }

  try {
    const result = await tool.handler({ principal }, args);
    if (result.audit) {
      await audit({ ...base, outcome: 'OK', targetUserId: result.audit.targetUserId ?? null, summary: result.audit.summary });
    }
    return { content: text(JSON.stringify(result.data, null, 2)) };
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.kind === 'denied') {
        await audit({ ...base, outcome: 'DENIED', summary: error.message });
      } else if (tool.access === 'WRITE') {
        await audit({ ...base, outcome: 'ERROR', summary: error.message });
      }
      return { isError: true, content: text(error.message) };
    }
    console.error(`MCP-Werkzeug ${tool.name} ist fehlgeschlagen:`, error);
    await audit({ ...base, outcome: 'ERROR', summary: 'Unerwarteter Fehler' });
    return { isError: true, content: text('Die Anfrage konnte nicht verarbeitet werden. Bitte später erneut versuchen.') };
  }
}
```

- [ ] **Step 8: Grün** — Run: `npx vitest run src/lib/mcp/tools` → PASS (7 + 6 Tests). `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 9: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools
git commit -m "feat: MCP-Werkzeug-Grundgerüst (Fehler, Seiten, runTool)"
```

---

### Task 3: Referenzwerkzeuge `list_organizations` und `list_dienstgrade`

**Files:**
- Create: `src/lib/mcp/tools/reference.ts`
- Test: `src/lib/mcp/tools/reference.db.test.ts`

**Interfaces:**
- Produces: `listOrganizations`, `listDienstgrade` (`ToolDefinition`); Ausgabe `list_organizations`: `{ items: { id, name, kurzname, art: 'Feuerwehr' | 'Abschnittskommando', abschnitt: string | null }[], nextCursor }`; `list_dienstgrade`: `{ items: { id, kurzform, bezeichnung }[] }`.

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/tools/reference.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { principalFixture, sessionUserFixture } from './test-support';
import { listDienstgrade, listOrganizations } from './reference';

let orgs: { id: string; name: string }[];

beforeAll(async () => {
  orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 3, select: { id: true, name: true } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const call = (user = sessionUserFixture(), input: Record<string, unknown> = {}) =>
  listOrganizations.handler({ principal: principalFixture(user) }, input);

describe('list_organizations', () => {
  it('zeigt einem Bezirksadmin alle aktiven Organisationen (Seiten zu höchstens 50)', async () => {
    const result = (await call(sessionUserFixture({ isBezirksAdmin: true }), {})).data as { items: unknown[]; nextCursor: string | null };
    expect(result.items.length).toBe(50);
    expect(result.nextCursor).not.toBeNull();
  });

  it('zeigt einem Feuerwehr-Admin nur seine Organisationen', async () => {
    const admin = sessionUserFixture({ feuerwehrAdminOrgIds: [orgs[0].id] });
    const result = (await call(admin)).data as { items: { id: string }[]; nextCursor: string | null };
    expect(result.items.map((o) => o.id)).toEqual([orgs[0].id]);
    expect(result.nextCursor).toBeNull();
  });

  it('liefert einem Mitglied ohne Verwaltungsbereich eine leere Liste', async () => {
    const result = (await call(sessionUserFixture())).data as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  it('filtert nach Suchtext ohne Rücksicht auf Groß-/Kleinschreibung', async () => {
    const admin = sessionUserFixture({ isBezirksAdmin: true });
    const result = (await call(admin, { query: orgs[1].name.toUpperCase() })).data as { items: { id: string }[] };
    expect(result.items.some((o) => o.id === orgs[1].id)).toBe(true);
  });
});

describe('list_dienstgrade', () => {
  it('liefert die Dienstgrade in der Rangfolge', async () => {
    const result = (await listDienstgrade.handler({ principal: principalFixture(sessionUserFixture()) }, {})).data as {
      items: { id: string; kurzform: string }[];
    };
    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items[0]).toHaveProperty('kurzform');
    expect(result.items[0]).toHaveProperty('bezeichnung');
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/reference.db.test.ts` → FAIL.

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/tools/reference.ts`:

```ts
import { z } from 'zod';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { clampLimit, decodeCursor, toPage } from './context';
import { defineTool } from './define';

export const listOrganizations = defineTool({
  name: 'list_organizations',
  description:
    'Listet Feuerwehren und Abschnittskommandos im eigenen Verwaltungsbereich (mit IDs, die z. B. create_user als homeOrganizationId braucht). Ohne Verwaltungsrecht ist die Liste leer.',
  access: 'READ',
  inputSchema: {
    query: z.string().max(100).optional().describe('Suchtext im Namen'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const query = input.query?.trim();

    const rows = await prisma.organization.findMany({
      where: {
        isActive: true,
        ...(isBezirksAdmin(user) ? {} : { id: { in: user.feuerwehrAdminOrgIds } }),
        ...(query
          ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { shortName: { contains: query, mode: 'insensitive' as const } }] }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: { id: true, name: true, shortName: true, type: true, parent: { select: { shortName: true, name: true } } },
    });

    const page = toPage(rows, limit, offset);
    return {
      data: {
        items: page.items.map((org) => ({
          id: org.id,
          name: org.name,
          kurzname: org.shortName,
          art: org.type === 'ABSCHNITTSKOMMANDO' ? 'Abschnittskommando' : 'Feuerwehr',
          abschnitt: org.parent ? (org.parent.shortName ?? org.parent.name) : null,
        })),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const listDienstgrade = defineTool({
  name: 'list_dienstgrade',
  description: 'Listet alle Dienstgrade (NÖ-Dienstgradtabelle) in der Rangfolge, mit IDs für create_user.',
  access: 'READ',
  inputSchema: {},
  handler: async () => {
    const rows = await prisma.dienstgrad.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, kurzform: true, bezeichnung: true } });
    return { data: { items: rows } };
  },
});
```

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/reference.db.test.ts` → PASS (5 Tests). Der erste Test setzt voraus, dass die lokale Datenbank mehr als 50 aktive Organisationen hat (Seed: 131); fehlt der Seed, vorher `npm run db:seed` ausführen.

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools/reference.ts src/lib/mcp/tools/reference.db.test.ts
git commit -m "feat: MCP-Werkzeuge list_organizations und list_dienstgrade"
```

---

### Task 4: MCP-Server und Endpunkt `/api/mcp`

**Files:**
- Create: `src/lib/mcp/tools/index.ts`, `src/lib/mcp/server.ts`, `src/app/api/mcp/route.ts`
- Test: `src/app/api/mcp/route.db.test.ts`

**Interfaces:**
- Consumes: `authenticateBearer`, `runTool`, `defineTool`, die Werkzeuge aus Task 3, `isMcpEnabled`, `getIssuer`, `CORS_HEADERS`, `hasMcpAccess`.
- Produces: `TOOLS: ToolDefinition[]` (wird in den folgenden Tasks erweitert); `createMcpServer(principal: McpPrincipal): McpServer`; `GET|POST|DELETE|OPTIONS` des Endpunkts.

Dies ist der **Spike** der Spec: er klärt, ob der Web-Standard-Transport des SDK direkt in einem Next.js-Route-Handler läuft. Der Test ruft die exportierten Handler direkt auf.

- [ ] **Step 1: Registrierung und Server**

Create `src/lib/mcp/tools/index.ts`:

```ts
import type { ToolDefinition } from './define';
import { listDienstgrade, listOrganizations } from './reference';

/** Alle Werkzeuge. Neue Werkzeuge werden hier eingetragen; die Stufe (READ/WRITE) steht am Werkzeug selbst. */
export const TOOLS: ToolDefinition[] = [listOrganizations, listDienstgrade];
```

Create `src/lib/mcp/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasMcpAccess } from './access';
import type { McpPrincipal } from './auth';
import { TOOLS } from './tools';
import { runTool } from './tools/run';

/**
 * Baut für EINE Anfrage einen zustandslosen MCP-Server. Nur Werkzeuge, die die Stufe des Aufrufers erlaubt, werden
 * registriert (ein READ-Token sieht weder in tools/list noch beim Aufruf ein Schreibwerkzeug).
 */
export function createMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer({ name: 'feuerwehr-app-bezirk-17', version: '1.0.0' });
  for (const tool of TOOLS) {
    if (!hasMcpAccess(principal.access, tool.access)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.access === 'READ',
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args: unknown) => runTool(principal, tool, args),
    );
  }
  return server;
}
```

- [ ] **Step 2: Failing Route-Test**

Create `src/app/api/mcp/route.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled, setMcpEnabled } from '@/lib/mcp/enabled';
import { issueTestToken } from '@/lib/mcp/test-support-db';
import { OPTIONS, POST } from './route';

const RUN = `mcp-route-${Date.now()}`;
let userId: string;
let wasEnabled: boolean;
let readToken: string;

function rpc(method: string, params: unknown, token?: string) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

beforeAll(async () => {
  wasEnabled = await isMcpEnabled();
  await setMcpEnabled(true);
  process.env.AUTH_URL = 'https://app-17.example.test';
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Route', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'READ' },
  });
  userId = user.id;
  readToken = (await issueTestToken({ userId, namePrefix: RUN })).accessToken;
});

afterAll(async () => {
  await setMcpEnabled(wasEnabled);
  await prisma.oauthToken.deleteMany({ where: { userId } });
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.mcpAuditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('/api/mcp', () => {
  it('antwortet ohne Token mit 401 und verweist auf die Resource-Metadaten', async () => {
    const response = await POST(rpc('tools/list', {}));
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://app-17.example.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it('listet mit gültigem Token die Werkzeuge der Stufe (READ: keine Schreibwerkzeuge)', async () => {
    const response = await POST(rpc('tools/list', {}, readToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('list_organizations');
    expect(names).toContain('list_dienstgrade');
    expect(names).not.toContain('create_user');
  });

  it('führt ein Werkzeug aus', async () => {
    const response = await POST(rpc('tools/call', { name: 'list_dienstgrade', arguments: {} }, readToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBeFalsy();
    expect(JSON.parse(body.result.content[0].text).items.length).toBeGreaterThan(10);
  });

  it('antwortet bei ausgeschaltetem Funktionsschalter mit 404', async () => {
    await setMcpEnabled(false);
    expect((await POST(rpc('tools/list', {}, readToken))).status).toBe(404);
    await setMcpEnabled(true);
  });

  it('beantwortet OPTIONS (CORS)', async () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
```

- [ ] **Step 3: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/app/api/mcp/route.db.test.ts` → FAIL (`./route` fehlt).

- [ ] **Step 4: Route implementieren**

Create `src/app/api/mcp/route.ts`:

```ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateBearer } from '@/lib/mcp/auth';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { CORS_HEADERS, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { getIssuer } from '@/lib/mcp/oauth/metadata';
import { createMcpServer } from '@/lib/mcp/server';

export function OPTIONS() {
  return optionsResponse();
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function unauthorized(status: 401 | 403, error: 'invalid_token' | 'insufficient_scope'): Response {
  const resourceMetadata = `${getIssuer()}/.well-known/oauth-protected-resource/api/mcp`;
  const challenge =
    status === 401
      ? `Bearer resource_metadata="${resourceMetadata}"`
      : `Bearer error="insufficient_scope", resource_metadata="${resourceMetadata}"`;
  return withCors(
    new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge } }),
  );
}

/**
 * MCP über Streamable HTTP, zustandslos: je Anfrage ein eigener Server und Transport (kein Session-Speicher, daher
 * mehrere Container und Neustarts unkritisch). `enableJsonResponse` liefert normale JSON-Antworten statt SSE.
 */
async function handle(request: Request): Promise<Response> {
  if (!(await isMcpEnabled())) return notFoundResponse();

  const auth = await authenticateBearer(request.headers.get('authorization'));
  if (!auth.ok) return unauthorized(auth.status, auth.error);

  const server = createMcpServer(auth.principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
```

- [ ] **Step 5: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/app/api/mcp/route.db.test.ts` → PASS (5 Tests).

Falls der Test auf `tools/list` mit einem Fehler wie "Server not initialized" antwortet: im Test vorher eine `initialize`-Anfrage mit `{ protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }` an **dieselbe** Route senden ändert in der zustandslosen Betriebsart nichts (jede Anfrage bekommt einen frischen Server) — dann darf die Route **nicht** zustandslos laufen, und die Aufgabe ist zu melden (BLOCKED) statt umzubauen, weil das die Architektur der Spec berührt. Erwartet wird, dass es ohne `initialize` funktioniert (so ist der zustandslose Betrieb im SDK vorgesehen).

- [ ] **Step 6: Typprüfung und Build** — `npx tsc --noEmit` und `npm run build` → ohne Fehler; `/api/mcp` steht in der Routenliste.

- [ ] **Step 7: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/server.ts src/lib/mcp/tools/index.ts src/app/api/mcp
git commit -m "feat: MCP-Endpunkt /api/mcp (zustandslos) mit Referenzwerkzeugen"
```

---

### Task 5: `list_users` und `get_user`

**Files:**
- Create: `src/lib/mcp/tools/users.ts`
- Modify: `src/lib/mcp/tools/index.ts`
- Test: `src/lib/mcp/tools/users.test.ts` (rein), `src/lib/mcp/tools/users.db.test.ts`

**Interfaces:**
- Produces: `userScopeWhere(user: SessionUser): Prisma.UserWhereInput`, `statusWhere(status: 'aktiv' | 'inaktiv' | 'deaktiviert'): Prisma.UserWhereInput`, `searchWhere(query: string): Prisma.UserWhereInput`, `listUsers`, `getUser` (`ToolDefinition`).
- Ausgabe `list_users`: `{ items: UserDto[], nextCursor }`; `UserDto = { id, name, vorname, nachname, dienstgrad, heimatfeuerwehr, heimatfeuerwehrId, email, standesbuchnummer, telefon, status: 'aktiv'|'inaktiv'|'deaktiviert', adminFuer: string[], drohnengruppe: { name, rolle } | null, atemschutzgeraetetraeger: boolean, zuletztAktiv: string | null }`. `get_user` liefert zusätzlich `ausbildung: { a1a3Lizenz, a2Lizenz, stuetzpunktausbildung, bos1, bos2 }` (Datum `YYYY-MM-DD` oder `null`).

- [ ] **Step 1: Failing Test für die reinen Filter**

Create `src/lib/mcp/tools/users.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sessionUserFixture } from './test-support';
import { searchWhere, statusWhere, userScopeWhere } from './users';

describe('userScopeWhere', () => {
  it('Bezirksadmin: keine Einschränkung', () => {
    expect(userScopeWhere(sessionUserFixture({ isBezirksAdmin: true }))).toEqual({});
  });

  it('andere Admins: nur die Heimatfeuerwehren im eigenen Verwaltungsbereich', () => {
    expect(userScopeWhere(sessionUserFixture({ feuerwehrAdminOrgIds: ['a', 'b'] }))).toEqual({ homeOrganizationId: { in: ['a', 'b'] } });
  });
});

describe('statusWhere', () => {
  it('bildet die drei Zustände wie getUserStatus ab', () => {
    expect(statusWhere('aktiv')).toEqual({ isActive: true });
    expect(statusWhere('inaktiv')).toEqual({ isActive: false, passwordChangedAt: null });
    expect(statusWhere('deaktiviert')).toEqual({ isActive: false, passwordChangedAt: { not: null } });
  });
});

describe('searchWhere', () => {
  it('verknüpft die Suchwörter per UND über Vorname, Nachname und E-Mail', () => {
    expect(searchWhere(' Max  Muster ')).toEqual({
      AND: [
        { OR: [{ firstName: { contains: 'Max', mode: 'insensitive' } }, { lastName: { contains: 'Max', mode: 'insensitive' } }, { email: { contains: 'Max', mode: 'insensitive' } }] },
        { OR: [{ firstName: { contains: 'Muster', mode: 'insensitive' } }, { lastName: { contains: 'Muster', mode: 'insensitive' } }, { email: { contains: 'Muster', mode: 'insensitive' } }] },
      ],
    });
  });

  it('liefert für leeren Text keine Einschränkung', () => {
    expect(searchWhere('   ')).toEqual({});
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/mcp/tools/users.test.ts` → FAIL.

- [ ] **Step 3: Failing DB-Test für die Werkzeuge**

Create `src/lib/mcp/tools/users.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { principalFixture, sessionUserFixture } from './test-support';
import { getUser, listUsers } from './users';

const RUN = `mcp-users-${Date.now()}`;
let orgA: { id: string };
let orgB: { id: string };
const ids: Record<string, string> = {};

async function makeUser(key: string, organizationId: string, extra: { isActive?: boolean; passwordChangedAt?: Date | null } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'geheim-hash',
      firstName: key,
      lastName: RUN,
      stbNr: '77',
      phone: '+436601234567',
      homeOrganizationId: organizationId,
      isActive: extra.isActive ?? true,
      passwordChangedAt: extra.passwordChangedAt ?? null,
    },
  });
  ids[key] = user.id;
}

beforeAll(async () => {
  const orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 2 });
  [orgA, orgB] = orgs;
  await makeUser('aktiv', orgA.id);
  await makeUser('inaktiv', orgA.id, { isActive: false });
  await makeUser('deaktiviert', orgA.id, { isActive: false, passwordChangedAt: new Date('2026-01-01') });
  await makeUser('fremd', orgB.id);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

const asAdmin = (orgIds: string[]) => principalFixture(sessionUserFixture({ feuerwehrAdminOrgIds: orgIds }));
const run = async (principal: ReturnType<typeof asAdmin>, input: Record<string, unknown> = {}) =>
  (await listUsers.handler({ principal }, input)).data as { items: { id: string; status: string; email: string }[]; nextCursor: string | null };

describe('list_users', () => {
  it('zeigt einem Feuerwehr-Admin nur Benutzer der eigenen Feuerwehr, mit korrektem Status', async () => {
    const result = await run(asAdmin([orgA.id]), { query: RUN });
    expect(result.items.map((u) => u.id).sort()).toEqual([ids.aktiv, ids.inaktiv, ids.deaktiviert].sort());
    const byId = Object.fromEntries(result.items.map((u) => [u.id, u.status]));
    expect(byId[ids.aktiv]).toBe('aktiv');
    expect(byId[ids.inaktiv]).toBe('inaktiv');
    expect(byId[ids.deaktiviert]).toBe('deaktiviert');
  });

  it('zeigt einem Bezirksadmin auch Benutzer anderer Feuerwehren', async () => {
    const principal = principalFixture(sessionUserFixture({ isBezirksAdmin: true }));
    const result = await run(principal, { query: RUN });
    expect(result.items).toHaveLength(4);
  });

  it('filtert nach Status und Feuerwehr', async () => {
    const principal = principalFixture(sessionUserFixture({ isBezirksAdmin: true }));
    expect((await run(principal, { query: RUN, status: 'deaktiviert' })).items.map((u) => u.id)).toEqual([ids.deaktiviert]);
    expect((await run(principal, { query: RUN, organizationId: orgB.id })).items.map((u) => u.id)).toEqual([ids.fremd]);
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs ab', async () => {
    await expect(listUsers.handler({ principal: asAdmin([orgA.id]) }, { organizationId: orgB.id })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('lehnt Mitglieder ohne Verwaltungsrecht ab', async () => {
    await expect(listUsers.handler({ principal: principalFixture(sessionUserFixture()) }, {})).rejects.toMatchObject({ kind: 'denied' });
  });

  it('gibt weder Passwort-Hash noch Token aus und blättert mit Cursor', async () => {
    const principal = principalFixture(sessionUserFixture({ isBezirksAdmin: true }));
    const first = (await listUsers.handler({ principal }, { query: RUN, limit: 3 })).data as { items: object[]; nextCursor: string | null };
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/passwordHash|geheim-hash|icsToken/);
    const second = (await listUsers.handler({ principal }, { query: RUN, limit: 3, cursor: first.nextCursor! })).data as {
      items: object[];
      nextCursor: string | null;
    };
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe('get_user', () => {
  it('liefert einem Admin den Benutzer seiner Feuerwehr samt Ausbildung', async () => {
    const result = (await getUser.handler({ principal: asAdmin([orgA.id]) }, { userId: ids.aktiv })).data as { id: string; ausbildung: object };
    expect(result.id).toBe(ids.aktiv);
    expect(result.ausbildung).toEqual({ a1a3Lizenz: null, a2Lizenz: null, stuetzpunktausbildung: null, bos1: null, bos2: null });
  });

  it('antwortet für Benutzer außerhalb des Bereichs wie für unbekannte: nicht gefunden', async () => {
    await expect(getUser.handler({ principal: asAdmin([orgA.id]) }, { userId: ids.fremd })).rejects.toMatchObject({ message: 'Benutzer wurde nicht gefunden.' });
    await expect(getUser.handler({ principal: asAdmin([orgA.id]) }, { userId: 'gibt-es-nicht' })).rejects.toMatchObject({ message: 'Benutzer wurde nicht gefunden.' });
  });

  it('lehnt Mitglieder ohne Verwaltungsrecht ab', async () => {
    await expect(getUser.handler({ principal: principalFixture(sessionUserFixture()) }, { userId: ids.aktiv })).rejects.toMatchObject({ kind: 'denied' });
  });
});
```

- [ ] **Step 4: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/users.db.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 5: Implementieren**

Create `src/lib/mcp/tools/users.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { canAccessUserManagementAdmin, canManageUsersFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { getUserStatus } from '@/lib/auth/user-status';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import { clampLimit, decodeCursor, denied, invalid, toPage } from './context';
import { defineTool } from './define';

type StatusFilter = 'aktiv' | 'inaktiv' | 'deaktiviert';

/** Wessen Benutzer darf der Aufrufer sehen - exakt wie admin/benutzer/page.tsx. */
export function userScopeWhere(user: SessionUser): Prisma.UserWhereInput {
  return isBezirksAdmin(user) ? {} : { homeOrganizationId: { in: user.feuerwehrAdminOrgIds } };
}

/** Dieselbe Ableitung wie getUserStatus (lib/auth/user-status.ts), hier als Prisma-Bedingung. */
export function statusWhere(status: StatusFilter): Prisma.UserWhereInput {
  if (status === 'aktiv') return { isActive: true };
  if (status === 'inaktiv') return { isActive: false, passwordChangedAt: null };
  return { isActive: false, passwordChangedAt: { not: null } };
}

/** Jedes Suchwort muss in Vorname, Nachname oder E-Mail vorkommen ("Krebs Florian" = "Florian Krebs"). */
export function searchWhere(query: string): Prisma.UserWhereInput {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  return {
    AND: words.map((word) => ({
      OR: [
        { firstName: { contains: word, mode: 'insensitive' as const } },
        { lastName: { contains: word, mode: 'insensitive' as const } },
        { email: { contains: word, mode: 'insensitive' as const } },
      ],
    })),
  };
}

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  stbNr: true,
  phone: true,
  isActive: true,
  passwordChangedAt: true,
  lastLoginAt: true,
  istAtemschutzgeraeteTraeger: true,
  dienstgrad: { select: { kurzform: true } },
  homeOrganization: { select: { id: true, name: true, shortName: true } },
  memberships: { where: { role: 'ADMIN' as const }, select: { organization: { select: { name: true, shortName: true } } } },
  droneMembership: {
    select: {
      role: true,
      droneGroup: { select: { name: true } },
      a1a3LizenzAm: true,
      a2LizenzAm: true,
      stuetzpunktausbildungAm: true,
      bos1AusbildungAm: true,
      bos2AusbildungAm: true,
    },
  },
} satisfies Prisma.UserSelect;

type UserRecord = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

function toUserDto(user: UserRecord) {
  return {
    id: user.id,
    name: `${user.lastName} ${user.firstName}`,
    vorname: user.firstName,
    nachname: user.lastName,
    dienstgrad: user.dienstgrad?.kurzform ?? null,
    heimatfeuerwehr: user.homeOrganization.shortName ?? user.homeOrganization.name,
    heimatfeuerwehrId: user.homeOrganization.id,
    email: user.email,
    standesbuchnummer: user.stbNr,
    telefon: user.phone,
    status: getUserStatus(user).toLowerCase() as StatusFilter,
    adminFuer: user.memberships.map((m) => m.organization.shortName ?? m.organization.name),
    drohnengruppe: user.droneMembership
      ? { name: user.droneMembership.droneGroup.name, rolle: user.droneMembership.role === 'ADMIN' ? 'Admin' : 'Mitglied' }
      : null,
    atemschutzgeraetetraeger: user.istAtemschutzgeraeteTraeger,
    zuletztAktiv: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

function requireUserAdmin(user: SessionUser): void {
  if (!canAccessUserManagementAdmin(user)) {
    throw denied('Keine Berechtigung: Benutzer sehen dürfen nur Admins (Bezirk, Abschnitt oder Feuerwehr).');
  }
}

export const listUsers = defineTool({
  name: 'list_users',
  description:
    'Benutzerverwaltung: listet Benutzer im eigenen Verwaltungsbereich (Name, Dienstgrad, Feuerwehr, E-Mail, Status, Rollen). Nur für Admins.',
  access: 'READ',
  inputSchema: {
    query: z.string().max(100).optional().describe('Suchtext in Vorname, Nachname oder E-Mail'),
    organizationId: z.string().optional().describe('Nur Benutzer dieser Heimatfeuerwehr (ID aus list_organizations)'),
    status: z.enum(['aktiv', 'inaktiv', 'deaktiviert']).optional().describe('inaktiv = nie aktiviert, deaktiviert = vom Admin abgeschaltet'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireUserAdmin(user);
    if (input.organizationId && !canManageUsersFor(user, input.organizationId)) {
      throw denied('Keine Berechtigung für diese Feuerwehr.');
    }
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const rows = await prisma.user.findMany({
      where: {
        AND: [
          userScopeWhere(user),
          input.organizationId ? { homeOrganizationId: input.organizationId } : {},
          input.status ? statusWhere(input.status) : {},
          input.query ? searchWhere(input.query) : {},
        ],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: userSelect,
    });

    const page = toPage(rows, limit, offset);
    return { data: { items: page.items.map(toUserDto), nextCursor: page.nextCursor } };
  },
});

export const getUser = defineTool({
  name: 'get_user',
  description: 'Benutzerverwaltung: ein Benutzer im Detail, inklusive Drohnengruppen-Ausbildungsstufen. Nur für Admins, nur im eigenen Verwaltungsbereich.',
  access: 'READ',
  inputSchema: { userId: z.string().min(1).describe('ID aus list_users') },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireUserAdmin(user);
    const row = await prisma.user.findUnique({ where: { id: input.userId }, select: userSelect });
    // Außerhalb des Bereichs wird bewusst wie "unbekannt" geantwortet - sonst ließe sich die Existenz von Benutzern erraten.
    if (!row || !canManageUsersFor(user, row.homeOrganization.id)) throw invalid('Benutzer wurde nicht gefunden.');
    const training = row.droneMembership;
    return {
      data: {
        ...toUserDto(row),
        ausbildung: {
          a1a3Lizenz: day(training?.a1a3LizenzAm ?? null),
          a2Lizenz: day(training?.a2LizenzAm ?? null),
          stuetzpunktausbildung: day(training?.stuetzpunktausbildungAm ?? null),
          bos1: day(training?.bos1AusbildungAm ?? null),
          bos2: day(training?.bos2AusbildungAm ?? null),
        },
      },
    };
  },
});
```

In `src/lib/mcp/tools/index.ts` ergänzen: `import { getUser, listUsers } from './users';` und die Liste auf `[listOrganizations, listDienstgrade, listUsers, getUser]` erweitern.

- [ ] **Step 6: Grün** — Run: `npx vitest run src/lib/mcp/tools/users.test.ts` → PASS (5 Tests); `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/users.db.test.ts` → PASS (9 Tests); `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 7: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools
git commit -m "feat: MCP-Werkzeuge list_users und get_user"
```

---

### Task 6: `get_atemschutz_status`

**Files:**
- Create: `src/lib/mcp/tools/atemschutz.ts`
- Modify: `src/lib/mcp/tools/index.ts`
- Test: `src/lib/mcp/tools/atemschutz.test.ts` (rein), `src/lib/mcp/tools/atemschutz.db.test.ts`

**Interfaces:**
- Consumes: `getExpiryStatus`, `getFinnentestExpiryDate`, `AtemschutzExpiryStatus` aus `@/lib/heimatfeuerwehr/atemschutz-status`; `canManageHeimatfeuerwehrFor`, `isBezirksAdmin`; `NOT_DEACTIVATED_WHERE`.
- Produces: `combineStatus(a: AtemschutzExpiryStatus, b: AtemschutzExpiryStatus): AtemschutzExpiryStatus`, `getAtemschutzStatus` (`ToolDefinition`). Ausgabe: `{ eigener: AtemschutzDto | null, liste?: { items: AtemschutzDto[], nextCursor }, hinweis?: string }`, `AtemschutzDto = { id, name, feuerwehr, untersuchungGueltigBis: 'YYYY-MM-DD' | null, untersuchungStatus, finnentestAm, finnentestGueltigBis, finnentestStatus, gesamtStatus }`, Status ∈ `aktiv | laeuft_bald_ab | abgelaufen | keine_angabe`.

Regel `combineStatus`: ein `abgelaufen` ergibt `abgelaufen`; sonst ein `laeuft_bald_ab` ergibt `laeuft_bald_ab`; sonst sind beide `keine_angabe` → `keine_angabe`; sonst `aktiv` (auch wenn nur eines erfasst ist).

- [ ] **Step 1: Failing Test `combineStatus`**

Create `src/lib/mcp/tools/atemschutz.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { combineStatus } from './atemschutz';

describe('combineStatus', () => {
  it('abgelaufen schlägt alles', () => {
    expect(combineStatus('abgelaufen', 'aktiv')).toBe('abgelaufen');
    expect(combineStatus('keine_angabe', 'abgelaufen')).toBe('abgelaufen');
    expect(combineStatus('laeuft_bald_ab', 'abgelaufen')).toBe('abgelaufen');
  });

  it('dann läuft bald ab', () => {
    expect(combineStatus('aktiv', 'laeuft_bald_ab')).toBe('laeuft_bald_ab');
    expect(combineStatus('keine_angabe', 'laeuft_bald_ab')).toBe('laeuft_bald_ab');
  });

  it('keine Angabe nur, wenn beides fehlt; ein erfasster aktiver Wert genügt für aktiv', () => {
    expect(combineStatus('keine_angabe', 'keine_angabe')).toBe('keine_angabe');
    expect(combineStatus('aktiv', 'aktiv')).toBe('aktiv');
    expect(combineStatus('aktiv', 'keine_angabe')).toBe('aktiv');
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/mcp/tools/atemschutz.test.ts` → FAIL.

- [ ] **Step 3: Failing DB-Test**

Create `src/lib/mcp/tools/atemschutz.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getAtemschutzStatus } from './atemschutz';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-as-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let orgA: { id: string };
let orgB: { id: string };
const ids: Record<string, string> = {};

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown>) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: organizationId, ...extra },
  });
  ids[key] = user.id;
}

beforeAll(async () => {
  [orgA, orgB] = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 2 });
  await makeUser('aktiv', orgA.id, {
    istAtemschutzgeraeteTraeger: true,
    atemschutzGueltigBis: new Date(Date.now() + 400 * DAY),
    atemschutzFinnentestAm: new Date(Date.now() - 10 * DAY),
  });
  await makeUser('abgelaufen', orgA.id, {
    istAtemschutzgeraeteTraeger: true,
    atemschutzGueltigBis: new Date(Date.now() - 5 * DAY),
    atemschutzFinnentestAm: new Date(Date.now() - 10 * DAY),
  });
  await makeUser('keintraeger', orgA.id, { istAtemschutzgeraeteTraeger: false });
  await makeUser('fremd', orgB.id, { istAtemschutzgeraeteTraeger: true, atemschutzGueltigBis: new Date(Date.now() + 400 * DAY) });
  await makeUser('deaktiviert', orgA.id, {
    istAtemschutzgeraeteTraeger: true,
    isActive: false,
    passwordChangedAt: new Date('2026-01-01'),
    atemschutzGueltigBis: new Date(Date.now() + 400 * DAY),
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

type Item = { id: string; gesamtStatus: string };
type Result = { eigener: { gesamtStatus: string } | null; liste?: { items: Item[]; nextCursor: string | null } };
const call = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
  (await getAtemschutzStatus.handler({ principal: principalFixture(user) }, input)).data as Result;

/** Liest alle Seiten der Liste (die lokale Datenbank kann weitere Träger enthalten als die Testdaten). */
async function collect(user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const data = (await getAtemschutzStatus.handler({ principal: principalFixture(user) }, { ...input, limit: 50, cursor })).data as Result;
    items.push(...(data.liste?.items ?? []));
    cursor = data.liste?.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

describe('get_atemschutz_status', () => {
  it('zeigt jedem Träger den eigenen Status, ohne Liste', async () => {
    const result = await call(sessionUserFixture({ id: ids.aktiv, homeOrganizationId: orgA.id }));
    expect(result.eigener?.gesamtStatus).toBe('aktiv');
    expect(result.liste).toBeUndefined();
  });

  it('liefert für Nicht-Träger eigener = null', async () => {
    const result = await call(sessionUserFixture({ id: ids.keintraeger, homeOrganizationId: orgA.id }));
    expect(result.eigener).toBeNull();
  });

  it('zeigt einem Feuerwehr-Admin die Träger der eigenen Feuerwehr (ohne Nicht-Träger, ohne Deaktivierte, ohne fremde Feuerwehr)', async () => {
    const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
    const items = await collect(admin);
    const mine = items.filter((i) => Object.values(ids).includes(i.id)).map((i) => i.id).sort();
    expect(mine).toEqual([ids.aktiv, ids.abgelaufen].sort());
  });

  it('filtert nach Status', async () => {
    const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
    const items = await collect(admin, { status: 'abgelaufen' });
    expect(items.map((i) => i.id)).toContain(ids.abgelaufen);
    expect(items.map((i) => i.id)).not.toContain(ids.aktiv);
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs ab', async () => {
    const admin = sessionUserFixture({ id: 'admin-x', feuerwehrAdminOrgIds: [orgA.id] });
    await expect(getAtemschutzStatus.handler({ principal: principalFixture(admin) }, { organizationId: orgB.id })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('verlangt von einem Bezirksadmin eine Feuerwehr (sonst wäre die Liste riesig)', async () => {
    const admin = sessionUserFixture({ id: 'admin-y', isBezirksAdmin: true });
    const result = await call(admin);
    expect(result.liste).toBeUndefined();
    const withOrg = await collect(admin, { organizationId: orgB.id });
    expect(withOrg.map((i) => i.id)).toContain(ids.fremd);
  });
});
```

- [ ] **Step 4: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/atemschutz.db.test.ts` → FAIL.

- [ ] **Step 5: Implementieren**

Create `src/lib/mcp/tools/atemschutz.ts`:

```ts
import { z } from 'zod';
import { canManageHeimatfeuerwehrFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { prisma } from '@/lib/db/prisma';
import { getExpiryStatus, getFinnentestExpiryDate, type AtemschutzExpiryStatus } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { clampLimit, decodeCursor, denied, encodeCursor } from './context';
import { defineTool } from './define';

/** Schlechtester Zustand gewinnt; "keine Angabe" nur, wenn beide Werte fehlen. */
export function combineStatus(a: AtemschutzExpiryStatus, b: AtemschutzExpiryStatus): AtemschutzExpiryStatus {
  if (a === 'abgelaufen' || b === 'abgelaufen') return 'abgelaufen';
  if (a === 'laeuft_bald_ab' || b === 'laeuft_bald_ab') return 'laeuft_bald_ab';
  if (a === 'keine_angabe' && b === 'keine_angabe') return 'keine_angabe';
  return 'aktiv';
}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

interface AtemschutzRow {
  id: string;
  firstName: string;
  lastName: string;
  atemschutzGueltigBis: Date | null;
  atemschutzFinnentestAm: Date | null;
  homeOrganization: { name: string; shortName: string | null };
}

function toDto(row: AtemschutzRow) {
  const finnentestBis = getFinnentestExpiryDate(row.atemschutzFinnentestAm);
  const untersuchungStatus = getExpiryStatus(row.atemschutzGueltigBis);
  const finnentestStatus = getExpiryStatus(finnentestBis);
  return {
    id: row.id,
    name: `${row.lastName} ${row.firstName}`,
    feuerwehr: row.homeOrganization.shortName ?? row.homeOrganization.name,
    untersuchungGueltigBis: day(row.atemschutzGueltigBis),
    untersuchungStatus,
    finnentestAm: day(row.atemschutzFinnentestAm),
    finnentestGueltigBis: day(finnentestBis),
    finnentestStatus,
    gesamtStatus: combineStatus(untersuchungStatus, finnentestStatus),
  };
}

const rowSelect = {
  id: true,
  firstName: true,
  lastName: true,
  atemschutzGueltigBis: true,
  atemschutzFinnentestAm: true,
  homeOrganization: { select: { name: true, shortName: true } },
} as const;

export const getAtemschutzStatus = defineTool({
  name: 'get_atemschutz_status',
  description:
    'Atemschutz: Gültigkeit von Untersuchung und Finnentest. Zeigt immer den eigenen Status; Admins zusätzlich die Atemschutzgeräteträger ihrer Feuerwehr(en). Ein Bezirksadmin muss organizationId angeben.',
  access: 'READ',
  inputSchema: {
    organizationId: z.string().optional().describe('Nur diese Feuerwehr (ID aus list_organizations)'),
    status: z.enum(['aktiv', 'laeuft_bald_ab', 'abgelaufen', 'keine_angabe']).optional().describe('Nur Träger mit diesem Gesamtstatus'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;

    const own = await prisma.user.findUnique({ where: { id: user.id }, select: { ...rowSelect, istAtemschutzgeraeteTraeger: true } });
    const eigener = own?.istAtemschutzgeraeteTraeger ? toDto(own) : null;

    if (input.organizationId && !canManageHeimatfeuerwehrFor(user, input.organizationId)) {
      throw denied('Keine Berechtigung für diese Feuerwehr.');
    }
    const orgIds = input.organizationId ? [input.organizationId] : isBezirksAdmin(user) ? null : user.feuerwehrAdminOrgIds;
    if (orgIds === null) {
      return { data: { eigener, hinweis: 'Für die Liste bitte organizationId angeben (Bezirksadmin).' } };
    }
    if (orgIds.length === 0) return { data: { eigener } };

    const rows = await prisma.user.findMany({
      where: { homeOrganizationId: { in: orgIds }, istAtemschutzgeraeteTraeger: true, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: rowSelect,
    });
    const all = rows.map(toDto).filter((dto) => !input.status || dto.gesamtStatus === input.status);

    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const items = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? encodeCursor(offset + limit) : null;
    return { data: { eigener, liste: { items, nextCursor } } };
  },
});
```

In `src/lib/mcp/tools/index.ts` ergänzen: `import { getAtemschutzStatus } from './atemschutz';` und in die Liste `getAtemschutzStatus` aufnehmen.

- [ ] **Step 6: Grün** — Run: `npx vitest run src/lib/mcp/tools/atemschutz.test.ts` → PASS (3 Tests); `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/atemschutz.db.test.ts` → PASS (6 Tests); `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 7: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools
git commit -m "feat: MCP-Werkzeug get_atemschutz_status"
```

---

### Task 7: `list_drone_flights` und `get_drone_readiness`

**Files:**
- Create: `src/lib/mcp/tools/drone.ts`
- Modify: `src/lib/mcp/tools/index.ts`
- Test: `src/lib/mcp/tools/drone.db.test.ts`

**Interfaces:**
- Consumes: `canViewDroneModule`, `getAllowedDroneGroups` (`@/lib/drone/flightbook-groups`), `getGruppenEinsatzbereitschaft`, `classifyFlightCount` (`@/lib/drone/einsatzbereitschaft`), `NINETY_DAY_REQUIRED_FLIGHTS`, `NINETY_DAY_WINDOW_DAYS`, `getNinetyDayCutoff`, `meetsNinetyDayRule`, `getComplianceUntilDate` (`@/lib/drone/ninety-day-rule`).
- Produces: `listDroneFlights`, `getDroneReadiness` (`ToolDefinition`).
  - `list_drone_flights` → `{ items: { id, datum: ISO, ort, drohne, pilot, zweck: 'Einsatz'|'Übung', drohnengruppe }[], nextCursor }`
  - `get_drone_readiness` → `{ eigener: { fluegeImFenster, erforderlich, fensterTage, regelErfuellt, gueltigBis: 'YYYY-MM-DD' | null, status: 'GRUEN'|'GELB'|'ROT' }, gruppe?: { name, mitglieder, a2Zertifikate, piloten: { id, name, feuerwehr, fluege, status }[] } }`

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/tools/drone.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getDroneReadiness, listDroneFlights } from './drone';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-drone-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let group: { id: string; organizationId: string };
let otherGroup: { id: string };
let drone: { id: string };
const ids: Record<string, string> = {};

async function makeUser(key: string, groupId: string | null, role: 'PILOT' | 'ADMIN' = 'PILOT', bos1 = false) {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      homeOrganizationId: org.id,
      ...(groupId
        ? {
            droneMembership: {
              create: {
                droneGroupId: groupId,
                role,
                ...(bos1
                  ? { a1a3LizenzAm: new Date('2025-01-01'), a2LizenzAm: new Date('2025-02-01'), stuetzpunktausbildungAm: new Date('2025-03-01'), bos1AusbildungAm: new Date('2025-04-01') }
                  : {}),
              },
            },
          }
        : {}),
    },
  });
  ids[key] = user.id;
}

async function flight(pilotKey: string, daysAgo: number, location: string) {
  await prisma.droneFlight.create({
    data: {
      startsAt: new Date(Date.now() - daysAgo * DAY),
      pilotUserId: ids[pilotKey],
      location: `${RUN} ${location}`,
      droneId: drone.id,
      purpose: 'UEBUNG',
      registeredById: ids[pilotKey],
    },
  });
}

beforeAll(async () => {
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true } });
  otherGroup = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Kirchberg' }, select: { id: true } });
  drone = await prisma.drone.create({ data: { name: `${RUN}-d`, droneGroupId: group.id } });
  await makeUser('pilot', group.id, 'PILOT', true);
  await makeUser('kollege', group.id, 'PILOT');
  await makeUser('admin', group.id, 'ADMIN');
  await makeUser('fremd', otherGroup.id);
  await makeUser('ohne', null);
  await flight('pilot', 5, 'A');
  await flight('pilot', 20, 'B');
  await flight('pilot', 200, 'alt');
  await flight('kollege', 7, 'C');
});

afterAll(async () => {
  await prisma.droneFlight.deleteMany({ where: { location: { startsWith: RUN } } });
  await prisma.drone.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

const memberUser = (key: string, role: 'PILOT' | 'ADMIN' = 'PILOT') =>
  sessionUserFixture({ id: ids[key], isDrohnengruppeMember: true, droneGroupId: group.id, droneGroupRole: role, abschnittAdminOrgIds: [], feuerwehrAdminOrgIds: [] });

type Flights = { items: { id: string; ort: string; pilot: string }[]; nextCursor: string | null };
// Der Zeitraum darf höchstens 366 Tage umfassen: 300 Tage zurück deckt alle Testflüge (5, 7, 20 und 200 Tage) ab.
const WIDE = { from: new Date(Date.now() - 300 * DAY).toISOString(), to: new Date(Date.now() + DAY).toISOString() };

/** Liest alle Seiten (die lokale Datenbank kann weitere Flüge enthalten) und liefert nur die Testflüge. */
async function flights(user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}): Promise<string[]> {
  const places: string[] = [];
  let cursor: string | undefined;
  do {
    const data = (await listDroneFlights.handler({ principal: principalFixture(user) }, { ...WIDE, ...input, limit: 50, cursor })).data as Flights;
    places.push(...data.items.map((f) => f.ort).filter((o) => o.startsWith(RUN)));
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return places;
}

describe('list_drone_flights', () => {
  it('zeigt einem Mitglied nur die eigenen Flüge im Zeitraum', async () => {
    const places = await flights(memberUser('pilot'));
    expect(places.sort()).toEqual([`${RUN} A`, `${RUN} B`, `${RUN} alt`].sort());
  });

  it('zeigt einem Gruppenadmin alle Flüge der Gruppe', async () => {
    expect(await flights(memberUser('admin', 'ADMIN'), { droneGroupId: group.id })).toHaveLength(4);
  });

  it('begrenzt den Zeitraum', async () => {
    const places = await flights(memberUser('admin', 'ADMIN'), { from: new Date(Date.now() - 30 * DAY).toISOString(), droneGroupId: group.id });
    expect(places).toHaveLength(3);
  });

  it('lehnt Benutzer ohne Zugriff auf das Drohnenmodul und fremde Gruppen ab', async () => {
    await expect(listDroneFlights.handler({ principal: principalFixture(sessionUserFixture({ id: ids.ohne })) }, WIDE)).rejects.toMatchObject({ kind: 'denied' });
    await expect(
      listDroneFlights.handler({ principal: principalFixture(memberUser('admin', 'ADMIN')) }, { ...WIDE, droneGroupId: otherGroup.id }),
    ).rejects.toMatchObject({ kind: 'denied' });
  });

  it('verlangt einen gültigen Zeitraum von höchstens 366 Tagen', async () => {
    await expect(listDroneFlights.handler({ principal: principalFixture(memberUser('pilot')) }, { from: '2024-01-01', to: '2026-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(listDroneFlights.handler({ principal: principalFixture(memberUser('pilot')) }, { from: 'kaputt', to: '2026-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('get_drone_readiness', () => {
  type Ready = { eigener: { fluegeImFenster: number; regelErfuellt: boolean; status: string }; gruppe?: { piloten: { id: string; fluege: number; status: string }[] } };
  const readiness = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
    (await getDroneReadiness.handler({ principal: principalFixture(user) }, input)).data as Ready;

  it('zeigt jedem Mitglied den eigenen 90-Tage-Status (nur Flüge im Fenster)', async () => {
    const result = await readiness(memberUser('pilot'));
    expect(result.eigener.fluegeImFenster).toBe(2);
    expect(result.eigener.regelErfuellt).toBe(false);
    expect(result.eigener.status).toBe('GELB');
    expect(result.gruppe).toBeUndefined();
  });

  it('zeigt Gruppenadmins zusätzlich die Ampel je BOS1-Pilot', async () => {
    const result = await readiness(memberUser('admin', 'ADMIN'), { droneGroupId: group.id });
    const pilot = result.gruppe!.piloten.find((p) => p.id === ids.pilot);
    expect(pilot).toMatchObject({ fluege: 2, status: 'GELB' });
  });

  it('lehnt Benutzer ohne Drohnenmodul ab', async () => {
    await expect(getDroneReadiness.handler({ principal: principalFixture(sessionUserFixture({ id: ids.ohne })) }, {})).rejects.toMatchObject({ kind: 'denied' });
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/drone.db.test.ts` → FAIL.

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/tools/drone.ts`:

```ts
import { z } from 'zod';
import { canViewDroneModule } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { classifyFlightCount, getGruppenEinsatzbereitschaft } from '@/lib/drone/einsatzbereitschaft';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import {
  NINETY_DAY_REQUIRED_FLIGHTS,
  NINETY_DAY_WINDOW_DAYS,
  getComplianceUntilDate,
  getNinetyDayCutoff,
  meetsNinetyDayRule,
} from '@/lib/drone/ninety-day-rule';
import type { SessionUser } from '@/types/next-auth';
import { clampLimit, decodeCursor, denied, invalid, toPage } from './context';
import { defineTool } from './define';

const MAX_RANGE_DAYS = 366;

/** Datum `YYYY-MM-DD` (Tagesbeginn bzw. -ende, UTC) oder ISO-Zeitpunkt; sonst `invalid`. */
export function parseRangeBound(value: string, endOfDay: boolean): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
  if (Number.isNaN(date.getTime())) throw invalid(`Ungültiges Datum: ${value}`);
  return date;
}

export function parseRange(from: string, to: string): { from: Date; to: Date } {
  const range = { from: parseRangeBound(from, false), to: parseRangeBound(to, true) };
  if (range.to.getTime() < range.from.getTime()) throw invalid('"to" liegt vor "from".');
  if (range.to.getTime() - range.from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw invalid(`Der Zeitraum darf höchstens ${MAX_RANGE_DAYS} Tage umfassen.`);
  }
  return range;
}

function requireDroneModule(user: SessionUser): void {
  if (!canViewDroneModule(user)) throw denied('Keine Berechtigung: Der Bereich ist nur für Mitglieder der Drohnengruppe.');
}

/** Gruppe, die der Aufrufer ansehen darf: Admins aus getAllowedDroneGroups, Mitglieder nur die eigene. */
async function resolveGroupId(user: SessionUser, requested: string | undefined, allowedIds: string[]): Promise<string | null> {
  if (allowedIds.length > 0) {
    if (requested && !allowedIds.includes(requested)) throw denied('Keine Berechtigung für diese Drohnengruppe.');
    return requested ?? allowedIds[0];
  }
  if (requested && requested !== user.droneGroupId) throw denied('Keine Berechtigung für diese Drohnengruppe.');
  return user.droneGroupId;
}

export const listDroneFlights = defineTool({
  name: 'list_drone_flights',
  description:
    'Drohnengruppe: Flugbuch im Zeitraum (Datum, Ort, Drohne, Pilot, Zweck). Mitglieder sehen die eigenen Flüge, Gruppenadmins alle Flüge ihrer Gruppe. Zeitraum höchstens 366 Tage.',
  access: 'READ',
  inputSchema: {
    from: z.string().describe('Beginn, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    to: z.string().describe('Ende, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    droneGroupId: z.string().optional().describe('Nur für Admins mit mehreren Gruppen'),
    pilotId: z.string().optional().describe('Nur Flüge dieses Piloten (nur für Admins)'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireDroneModule(user);
    const range = parseRange(input.from, input.to);
    const allowed = await getAllowedDroneGroups(user);
    const isAdmin = allowed.length > 0;
    const groupId = await resolveGroupId(user, input.droneGroupId, allowed.map((g) => g.id));
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const rows = await prisma.droneFlight.findMany({
      where: {
        startsAt: { gte: range.from, lte: range.to },
        ...(isAdmin
          ? { drone: { droneGroupId: groupId ?? undefined }, ...(input.pilotId ? { pilotUserId: input.pilotId } : {}) }
          : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] }),
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        startsAt: true,
        location: true,
        purpose: true,
        drone: { select: { name: true, droneGroup: { select: { name: true } } } },
        pilotUser: { select: { firstName: true, lastName: true } },
      },
    });

    const page = toPage(rows, limit, offset);
    return {
      data: {
        items: page.items.map((f) => ({
          id: f.id,
          datum: f.startsAt.toISOString(),
          ort: f.location,
          drohne: f.drone.name,
          pilot: `${f.pilotUser.lastName} ${f.pilotUser.firstName}`,
          zweck: f.purpose === 'EINSATZ' ? 'Einsatz' : 'Übung',
          drohnengruppe: f.drone.droneGroup.name,
        })),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getDroneReadiness = defineTool({
  name: 'get_drone_readiness',
  description:
    'Drohnengruppe: 90-Tage/3-Flüge-Regel. Zeigt immer den eigenen Status; Gruppenadmins zusätzlich die Einsatzbereitschafts-Ampel (grün/gelb/rot) je BOS1-Pilot ihrer Gruppe.',
  access: 'READ',
  inputSchema: { droneGroupId: z.string().optional().describe('Nur für Admins mit mehreren Gruppen') },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireDroneModule(user);

    const cutoff = getNinetyDayCutoff();
    const own = await prisma.droneFlight.findMany({
      where: { pilotUserId: user.id, startsAt: { gte: cutoff } },
      orderBy: { startsAt: 'desc' },
      select: { startsAt: true },
    });
    const compliantUntil = getComplianceUntilDate(own.map((f) => f.startsAt));
    const eigener = {
      fluegeImFenster: own.length,
      erforderlich: NINETY_DAY_REQUIRED_FLIGHTS,
      fensterTage: NINETY_DAY_WINDOW_DAYS,
      regelErfuellt: meetsNinetyDayRule(own.length),
      gueltigBis: compliantUntil ? compliantUntil.toISOString().slice(0, 10) : null,
      status: classifyFlightCount(own.length),
    };

    const allowed = await getAllowedDroneGroups(user);
    if (allowed.length === 0) return { data: { eigener } };
    const groupId = await resolveGroupId(user, input.droneGroupId, allowed.map((g) => g.id));
    if (!groupId) return { data: { eigener } };

    const group = await getGruppenEinsatzbereitschaft(groupId);
    return {
      data: {
        eigener,
        gruppe: {
          name: group.droneGroupName,
          mitglieder: group.totalMembers,
          a2Zertifikate: group.a2Count,
          piloten: group.pilots.map((p) => ({ id: p.id, name: p.name, feuerwehr: p.feuerwehr, fluege: p.flightCount, status: p.status })),
        },
      },
    };
  },
});
```

In `src/lib/mcp/tools/index.ts` ergänzen: `import { getDroneReadiness, listDroneFlights } from './drone';` und beide in die Liste aufnehmen.

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/drone.db.test.ts` → PASS (8 Tests). Falls `AFKDO Kirchberg` in der lokalen Datenbank fehlt (Seed-Name abweichend), im Test eine beliebige andere Gruppe mit `findFirstOrThrow({ where: { id: { not: group.id } } })` nehmen. `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools
git commit -m "feat: MCP-Werkzeuge list_drone_flights und get_drone_readiness"
```

---

### Task 8: `list_calendar_events`

**Files:**
- Create: `src/lib/mcp/tools/calendar.ts`
- Modify: `src/lib/mcp/tools/index.ts`
- Test: `src/lib/mcp/tools/calendar.db.test.ts`

**Interfaces:**
- Consumes: `canViewEvent`, `canViewDroneModule` (`@/lib/auth/permissions`), `getAbschnittOrganizationId`, `parseRange` (aus `./drone`).
- Produces: `listCalendarEvents` (`ToolDefinition`) → `{ items: { id, titel, beginn, ende, ganztaegig, ort, organisation, kategorie: 'Allgemein'|'Drohnengruppe', abschnittsweit, bezirksweit, sondergruppe, drohnengruppe, beschreibung? }[], nextCursor }`.

Die Abfrage spiegelt `kalender/page.tsx` (eigene Feuerwehr, abschnittsweit im eigenen Abschnitt, bezirksweit, Drohnengruppen-Termine) und filtert danach mit `canViewEvent`. Weil nach der Abfrage gefiltert wird, ist der Zeitraum Pflicht und wird komplett geladen; die Seiten entstehen im Speicher.

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/tools/calendar.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { listCalendarEvents } from './calendar';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-cal-${Date.now()}`;
let abschnitt: { id: string };
let orgA: { id: string; parentId: string | null };
let orgB: { id: string; parentId: string | null };
let foreignOrg: { id: string; parentId: string | null };
let creatorId: string;
let droneGroup: { id: string };

const START = new Date('2030-06-15T10:00:00Z');
const END = new Date('2030-06-15T12:00:00Z');

async function event(key: string, data: Record<string, unknown>) {
  await prisma.event.create({
    data: { title: `${RUN} ${key}`, startsAt: START, endsAt: END, createdById: creatorId, organizationId: orgA.id, description: `Beschreibung ${key}`, ...data } as never,
  });
}

beforeAll(async () => {
  const feuerwehren = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true, parentId: { not: null } }, orderBy: { name: 'asc' } });
  orgA = feuerwehren[0];
  const sameAbschnitt = feuerwehren.find((o) => o.id !== orgA.id && o.parentId === orgA.parentId);
  orgB = sameAbschnitt!;
  foreignOrg = feuerwehren.find((o) => o.parentId !== orgA.parentId)!;
  abschnitt = { id: orgA.parentId! };
  droneGroup = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' } });
  const creator = await prisma.user.create({ data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Cal', lastName: RUN, homeOrganizationId: orgA.id } });
  creatorId = creator.id;

  await event('eigen', { organizationId: orgA.id });
  await event('andere-ff', { organizationId: orgB.id });
  await event('abschnitt', { organizationId: orgB.id, isSectionWide: true });
  await event('fremd', { organizationId: foreignOrg.id });
  await event('fremd-abschnitt', { organizationId: foreignOrg.id, isSectionWide: true });
  await event('bezirk', { organizationId: foreignOrg.id, isDistrictWide: true });
  await event('drohne', { organizationId: orgB.id, category: 'DROHNENGRUPPE', droneGroupId: droneGroup.id });
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { title: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: creatorId } });
  await prisma.$disconnect();
});

const member = (overrides = {}) =>
  sessionUserFixture({ homeOrganizationId: orgA.id, homeAbschnittOrganizationId: abschnitt.id, ...overrides });

type Result = { items: { titel: string; beschreibung?: string }[]; nextCursor: string | null };
const call = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
  (await listCalendarEvents.handler({ principal: principalFixture(user) }, { from: '2030-06-01', to: '2030-06-30', ...input })).data as Result;
const titles = (r: Result) => r.items.map((i) => i.titel.replace(`${RUN} `, '')).sort();

describe('list_calendar_events', () => {
  it('zeigt einem Mitglied eigene Feuerwehr, Abschnitt und Bezirk - nicht fremde Termine und keine Drohnengruppen-Termine', async () => {
    const result = await call(member());
    expect(titles(result).filter((t) => ['eigen', 'andere-ff', 'abschnitt', 'fremd', 'fremd-abschnitt', 'bezirk', 'drohne'].includes(t))).toEqual(['abschnitt', 'bezirk', 'eigen']);
  });

  it('zeigt Mitgliedern der Drohnengruppe zusätzlich deren Termine', async () => {
    const result = await call(member({ isDrohnengruppeMember: true, droneGroupId: droneGroup.id, droneGroupRole: 'PILOT' }));
    expect(titles(result)).toContain('drohne');
  });

  it('lässt Beschreibungen nur auf Wunsch zu und kürzt sie', async () => {
    const without = await call(member(), { organizationId: orgA.id });
    expect(without.items.every((i) => i.beschreibung === undefined)).toBe(true);
    const withDescription = await call(member(), { includeDescription: true });
    expect(withDescription.items.find((i) => i.titel === `${RUN} eigen`)?.beschreibung).toBe('Beschreibung eigen');
  });

  it('blättert über Seiten', async () => {
    const first = await call(member(), { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await call(member(), { limit: 1, cursor: first.nextCursor! });
    expect(second.items[0].titel).not.toBe(first.items[0].titel);
  });

  it('verlangt einen gültigen Zeitraum von höchstens 366 Tagen', async () => {
    await expect(listCalendarEvents.handler({ principal: principalFixture(member()) }, { from: '2028-01-01', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/calendar.db.test.ts` → FAIL.

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/tools/calendar.ts`:

```ts
import { z } from 'zod';
import { canViewDroneModule, canViewEvent } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';
import { clampLimit, decodeCursor, encodeCursor } from './context';
import { defineTool } from './define';
import { parseRange } from './drone';

const DESCRIPTION_MAX = 1000;

export const listCalendarEvents = defineTool({
  name: 'list_calendar_events',
  description:
    'Kalender: Termine im Zeitraum, die der Benutzer auch in der App sieht (eigene Feuerwehr, Abschnitt, Bezirk, bei Mitgliedschaft auch Drohnengruppen-Termine). Zeitraum höchstens 366 Tage.',
  access: 'READ',
  inputSchema: {
    from: z.string().describe('Beginn, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    to: z.string().describe('Ende, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    organizationId: z.string().optional().describe('Nur Termine dieser Organisation'),
    sondergruppeId: z.string().optional().describe('Nur Termine dieser Sondergruppe'),
    includeDescription: z.boolean().optional().describe('Beschreibungstext mitliefern (Standard: nein, wird auf 1000 Zeichen gekürzt)'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    const range = parseRange(input.from, input.to);
    const canSeeDroneCategory = canViewDroneModule(user);

    // Dieselbe Vorauswahl wie kalender/page.tsx; die endgültige Sichtbarkeit entscheidet canViewEvent unten.
    const events = await prisma.event.findMany({
      where: {
        AND: [
          { startsAt: { lte: range.to }, endsAt: { gte: range.from } },
          input.organizationId ? { organizationId: input.organizationId } : {},
          input.sondergruppeId ? { sondergruppeId: input.sondergruppeId } : {},
          {
            OR: [
              { organizationId: user.homeOrganizationId },
              { isSectionWide: true, organization: { OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }] } },
              { category: 'ALLGEMEIN' as const, isDistrictWide: true },
              ...(canSeeDroneCategory ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }] : []),
            ],
          },
        ],
      },
      include: {
        organization: { select: { id: true, type: true, parentId: true, name: true, shortName: true } },
        sondergruppe: { select: { name: true } },
        droneGroup: { select: { name: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    const visible = events.filter((event) =>
      canViewEvent(user, {
        organizationId: event.organizationId,
        isSectionWide: event.isSectionWide,
        isDistrictWide: event.isDistrictWide,
        category: event.category,
        eventAbschnittOrganizationId: getAbschnittOrganizationId(event.organization),
        droneGroupId: event.droneGroupId,
      }),
    );

    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const items = visible.slice(offset, offset + limit).map((event) => ({
      id: event.id,
      titel: event.title,
      beginn: event.startsAt.toISOString(),
      ende: event.endsAt.toISOString(),
      ganztaegig: event.allDay,
      ort: event.location,
      organisation: event.organization.shortName ?? event.organization.name,
      kategorie: event.category === 'DROHNENGRUPPE' ? 'Drohnengruppe' : 'Allgemein',
      abschnittsweit: event.isSectionWide,
      bezirksweit: event.isDistrictWide,
      sondergruppe: event.sondergruppe?.name ?? null,
      drohnengruppe: event.droneGroup?.name ?? null,
      ...(input.includeDescription ? { beschreibung: event.description ? event.description.slice(0, DESCRIPTION_MAX) : null } : {}),
    }));
    const nextCursor = offset + limit < visible.length ? encodeCursor(offset + limit) : null;
    return { data: { items, nextCursor } };
  },
});
```

In `src/lib/mcp/tools/index.ts` ergänzen: `import { listCalendarEvents } from './calendar';` und `listCalendarEvents` in die Liste aufnehmen.

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/calendar.db.test.ts` → PASS (5 Tests). Der Test braucht in der lokalen Datenbank mindestens zwei Feuerwehren im selben Abschnitt und eine in einem anderen (Seed erfüllt das). `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools
git commit -m "feat: MCP-Werkzeug list_calendar_events"
```

---

### Task 9: Gesamtprüfung und Test mit einem echten Client

- [ ] **Step 1: Automatische Prüfung**

```bash
npm test
npm run test:db
npx tsc --noEmit
npm run build
```

Expected: alles grün. `route.db.test.ts` prüft zusätzlich, dass `tools/list` alle acht Werkzeuge liefert — dazu in diesem Test die Erwartung ergänzen:

```ts
    for (const name of ['list_users', 'get_user', 'get_atemschutz_status', 'list_drone_flights', 'get_drone_readiness', 'list_calendar_events']) {
      expect(names).toContain(name);
    }
```

(in den Test "listet mit gültigem Token die Werkzeuge der Stufe", nach `expect(names).toContain('list_dienstgrade');`) und `npx vitest run -c vitest.db.config.ts src/app/api/mcp/route.db.test.ts` erneut laufen lassen.

- [ ] **Step 2: Manuelle Prüfung mit dem MCP Inspector (lokal)**

Dev-Server starten (`npm run dev`), Connector in `/admin/mcp` einschalten, einem Test-Benutzer `READ` geben. Dann:

```bash
npx @modelcontextprotocol/inspector
```

Im Inspector: Transport "Streamable HTTP", URL `http://localhost:3000/api/mcp`, "Open Auth Settings" → "Quick OAuth Flow". Der Browser öffnet die Zustimmungsseite (`/oauth/authorize`), nach "Erlauben" ist der Inspector verbunden. Prüfen: `tools/list` zeigt die acht Lesewerkzeuge, `list_dienstgrade` liefert Daten, `list_users` liefert für einen Nicht-Admin die Ablehnung "Keine Berechtigung …" und für einen Admin nur Benutzer seines Bereichs. Den Benutzer in der Benutzerverwaltung auf `NONE` setzen: der nächste Aufruf im Inspector scheitert mit 403.

- [ ] **Step 3: Test mit Claude bzw. ChatGPT (auf DEV, nach Deploy)**

Connector einschalten (`/admin/mcp` auf DEV), in Claude unter Einstellungen → Connectors → "Benutzerdefinierten Connector hinzufügen" die URL `https://<dev-domain>/api/mcp` eintragen (Client-ID/Secret leer lassen, Claude registriert sich selbst) und die Anmeldung durchlaufen. In ChatGPT (Entwicklermodus, "Neuer Connector", Authentifizierung OAuth) dasselbe. Beim ersten Versuch stimmen eventuell die erlaubten Rücksprungadressen nicht: Dann schlägt `/oauth/register` mit `invalid_redirect_uri` fehl — die im Fehlerfall von der Plattform genutzte Adresse (steht im Request des Clients) in `ALLOWED_HTTPS_HOSTS` aufnehmen, Testfall in `redirect-uris.test.ts` ergänzen und erneut deployen.

## Phase-3-Abnahme

- `/api/mcp` antwortet ohne Token mit 401 + `WWW-Authenticate`, mit Token zustandslos per JSON-RPC; ausgeschaltet 404.
- Alle acht Lesewerkzeuge sind registriert; jedes liefert nur, was die App dem Benutzer zeigt; Ablehnungen stehen im Prüfprotokoll.
- Entzug von `mcpAccess` wirkt sofort (403), Mengenbegrenzung 120/min.
- Ein echter Client (Inspector, später Claude/ChatGPT) kann sich anmelden und abfragen.
