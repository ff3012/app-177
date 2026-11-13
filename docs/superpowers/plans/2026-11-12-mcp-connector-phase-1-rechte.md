# MCP-Connector · Phase 1: Rechtefeld, Vergabe, Schalter, Prüfprotokoll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Grundlage des MCP-Connectors: Datenbank-Tabellen, das Recht `User.mcpAccess` mit Vergabe in der Benutzerverwaltung (inkl. Obergrenze), der Funktionsschalter `AppSettings.mcpEnabled` und die Hilfsbausteine Prüfprotokoll und Mengenbegrenzung. Am Ende dieser Phase ist noch kein MCP-Endpunkt erreichbar, aber alles ist vergeb- und testbar.

**Architecture:** Eine additive Migration legt Enum, Spalten und vier Tabellen an (alle OAuth-/Audit-Tabellen schon jetzt, damit Phase 2 und 3 keine weitere Migration brauchen). Die Vergaberegel ist eine reine Funktion `canGrantMcpAccess` in `lib/auth/permissions.ts`, die Server Actions `createUser`/`updateUser` setzen sie serverseitig durch. Die Pflege des Schalters liegt auf einer neuen Seite `/admin/mcp` (nur Bezirksadmin).

**Tech Stack:** Next.js 15 App Router, Prisma 6 (PostgreSQL), zod, vitest, shadcn/Radix (`SegmentedControl`).

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-connector-design.md`

## Global Constraints

- **Datenumfang wie in der App:** Das MCP-Recht schaltet nur den Connector frei; es erweitert nie eine Sichtbarkeit.
- **Vergabe:** Bezirksadmin darf jede Stufe an jeden vergeben. Abschnitts-/Feuerwehr-Admin nur, wenn `canManageUsersFor(user, target.homeOrganizationId)` gilt **und** neue Stufe **und** bisherige Stufe des Ziels nicht höher sind als die eigene.
- **Nie über MCP setzbar** (Spec, Entscheidung 3): `isBezirksAdmin`, `isBezirksDrohnenAdmin`, `mcpAccess`.
- **Migration rein additiv**, `mcpAccess` Standard `NONE`, `mcpEnabled` Standard `false`. Kein Backfill.
- **Keine neuen Umgebungsvariablen.**
- **Migrationen:** Der bekannte Reihenfolgefehler in `20260819100617_news_modul` (siehe `CLAUDE.md`, "Known pre-existing ordering bug") verhindert `prisma migrate dev`. Migrationen werden deshalb mit `prisma migrate diff --from-url` erzeugt, als Ordner abgelegt und mit `prisma migrate deploy` lokal angewendet. Bereits committete Migrationen nie ändern.
- **Tests:** `npm test` (Unit, ohne Datenbank) und `npm run test:db` (nur gegen die LOKALE Dev-Datenbank). Vor jedem "fertig": `npx tsc --noEmit` und `npm run build`.
- **Zeilenenden:** Viele Dateien im Repo haben CRLF, `core.autocrlf=true` normalisiert beim Commit. Shell-Skripte (`docker/*.sh`) müssen LF bleiben.
- **Commits:** Die Commit-Schritte sind Vorschläge für den Zeitpunkt; committet und gepusht wird nur auf ausdrückliche Anweisung des Nutzers. Nie `android/`, `AGENTS.md`, `docs/agents` committen.
- **UI-Texte auf Deutsch**, Bezeichner wie im Rest der Datei.

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma` (ändern) | Enum `McpAccess`, `McpAuditOutcome`; `User.mcpAccess`; `AppSettings.mcpEnabled`; Modelle `OauthClient`, `OauthAuthorizationCode`, `OauthToken`, `McpAuditLog` |
| `prisma/migrations/20261112090000_mcp_connector/migration.sql` (neu) | additive Migration |
| `src/lib/mcp/access.ts` (neu) | `McpAccessLevel`, `mcpRank`, `hasMcpAccess`, `parseMcpAccess` — rein, ohne Datenbank |
| `src/lib/mcp/access-db.ts` (neu) | `getMcpAccessOf(userId)` |
| `src/lib/mcp/enabled.ts` (neu) | `isMcpEnabled()`, `setMcpEnabled()` |
| `src/lib/mcp/audit.ts` (neu) | `recordMcpAudit`, `countRecentOk` |
| `src/lib/mcp/rate-limit.ts` (neu) | `checkRateLimit` (im Speicher) |
| `src/lib/auth/permissions.ts` (ändern) | `canGrantMcpAccess` |
| `src/lib/validation/user.schema.ts` (ändern) | Feld `mcpAccess` (optional) |
| `src/app/(app)/admin/benutzer/actions.ts` (ändern) | Vergabe serverseitig prüfen und speichern |
| `src/components/admin/user-form-sheet.tsx` (ändern) | Abschnitt "KI-Zugriff (MCP)" |
| `src/app/(app)/admin/benutzer/page.tsx`, `user-management-section.tsx` (ändern) | `mcpAccess` je Zeile, `viewerMcpAccess` |
| `src/app/(app)/admin/mcp/page.tsx`, `actions.ts` (neu) | Schalter (nur Bezirksadmin) |
| `src/lib/admin/nav-items.ts` (ändern) | Eintrag "KI-Zugriff" |

---

### Task 1: Datenmodell und Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261112090000_mcp_connector/migration.sql`

**Interfaces:**
- Produces: Prisma-Modelle `prisma.oauthClient`, `prisma.oauthAuthorizationCode`, `prisma.oauthToken`, `prisma.mcpAuditLog`; Enum-Typen `McpAccess`, `McpAuditOutcome` aus `@prisma/client`; Felder `User.mcpAccess`, `AppSettings.mcpEnabled`.

- [ ] **Step 1: Enums hinzufügen**

In `prisma/schema.prisma` direkt nach `enum ChecklistStatus { ... }` einfügen:

```prisma
// MCP-Connector (Claude/ChatGPT), siehe docs/superpowers/specs/2026-11-12-mcp-connector-design.md.
// WRITE schließt READ ein.
enum McpAccess {
  NONE
  READ
  WRITE
}

enum McpAuditOutcome {
  OK
  DENIED
  ERROR
}
```

- [ ] **Step 2: `User` erweitern**

Im `model User` direkt unter dem Feld `isBezirksDrohnenAdmin Boolean @default(false)` einfügen:

```prisma
  // Recht für den MCP-Connector (siehe McpAccess). Vergabe: lib/auth/permissions.ts canGrantMcpAccess.
  mcpAccess McpAccess @default(NONE)

  oauthTokens    OauthToken[]
  oauthAuthCodes OauthAuthorizationCode[]
  mcpAuditLogs   McpAuditLog[]
```

- [ ] **Step 3: `AppSettings` erweitern**

Im `model AppSettings` vor der schließenden Klammer einfügen:

```prisma
  // Funktionsschalter für den MCP-Connector. Aus: /api/mcp und /oauth/* antworten wie "nicht vorhanden".
  mcpEnabled Boolean @default(false)
```

- [ ] **Step 4: Neue Modelle ans Dateiende**

```prisma
// OAuth-Client eines MCP-Connectors (Dynamic Client Registration). Öffentlicher Client (PKCE, kein Secret).
// `clientId` ist die nach außen gegebene Kennung, `id` der interne Schlüssel.
model OauthClient {
  id           String   @id @default(cuid())
  clientId     String   @unique
  name         String
  redirectUris String[]
  createdAt    DateTime @default(now())

  authCodes OauthAuthorizationCode[]
  tokens    OauthToken[]
}

// Einmal einlösbarer Autorisierungscode, nur als SHA-256-Hash gespeichert, 60 Sekunden gültig.
model OauthAuthorizationCode {
  id            String      @id @default(cuid())
  codeHash      String      @unique
  oauthClientId String
  oauthClient   OauthClient @relation(fields: [oauthClientId], references: [id], onDelete: Cascade)
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  redirectUri   String
  codeChallenge String
  scope         String
  expiresAt     DateTime
  usedAt        DateTime?
  createdAt     DateTime    @default(now())

  @@index([userId])
}

// Access-Token (1 h) + Refresh-Token (30 Tage, rotierend), beide nur als Hash. revokedAt gesetzt =
// widerrufen ODER durch Rotation ersetzt (Wiederverwendung eines ersetzten Refresh-Tokens widerruft die ganze Kette).
model OauthToken {
  id               String      @id @default(cuid())
  accessTokenHash  String      @unique
  refreshTokenHash String      @unique
  oauthClientId    String
  oauthClient      OauthClient @relation(fields: [oauthClientId], references: [id], onDelete: Cascade)
  userId           String
  user             User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  scope            String
  expiresAt        DateTime
  refreshExpiresAt DateTime
  revokedAt        DateTime?
  lastUsedAt       DateTime?
  createdAt        DateTime    @default(now())

  @@index([userId, oauthClientId])
}

// Prüfprotokoll: alle Schreibaktionen und alle abgelehnten Zugriffe. summary enthält bewusst keine
// Freitexte (Telefonnummer u. Ä.).
model McpAuditLog {
  id           String          @id @default(cuid())
  userId       String?
  user         User?           @relation(fields: [userId], references: [id], onDelete: SetNull)
  clientId     String?
  tool         String
  outcome      McpAuditOutcome
  targetUserId String?
  summary      String
  createdAt    DateTime        @default(now())

  @@index([createdAt])
  @@index([userId, tool, createdAt])
}
```

- [ ] **Step 5: Migration aus dem Unterschied zur lokalen Datenbank erzeugen**

Im Repo-Wurzelverzeichnis (bash). Der Befehl liest die lokale `DATABASE_URL`, gibt sie nicht aus:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
mkdir -p prisma/migrations/20261112090000_mcp_connector
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261112090000_mcp_connector/migration.sql
```

Erwartung: die Datei enthält `CREATE TYPE "McpAccess"`, `CREATE TYPE "McpAuditOutcome"`, `ALTER TABLE "AppSettings" ADD COLUMN "mcpEnabled"`, `ALTER TABLE "User" ADD COLUMN "mcpAccess"`, vier `CREATE TABLE` (`OauthClient`, `OauthAuthorizationCode`, `OauthToken`, `McpAuditLog`), Indizes und Fremdschlüssel — und **nichts** über andere Tabellen. Falls die Datei weitere Änderungen enthält, ist die lokale Datenbank nicht auf dem Stand von `main`: erst `npx prisma migrate deploy`, dann Schritt 5 wiederholen.

- [ ] **Step 6: Migration lokal anwenden, Client erzeugen, Übereinstimmung prüfen**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Erwartung: `migrate deploy` meldet "1 migration" angewendet; der letzte Befehl endet mit Exit-Code 0 ("No difference detected").

- [ ] **Step 7: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Fehler (die neuen Felder sind optional/mit Standard; nichts baut sie bisher).

- [ ] **Step 8: Commit (nur auf Anweisung)**

```bash
git add prisma/schema.prisma prisma/migrations/20261112090000_mcp_connector
git commit -m "feat: MCP-Connector Datenmodell (mcpAccess, mcpEnabled, OAuth- und Audit-Tabellen)"
```

---

### Task 2: Zugriffsstufen und `canGrantMcpAccess`

**Files:**
- Create: `src/lib/mcp/access.ts`, `src/lib/mcp/access-db.ts`
- Modify: `src/lib/auth/permissions.ts`
- Test: `src/lib/mcp/access.test.ts`, `src/lib/auth/permissions.mcp.test.ts`

**Interfaces:**
- Produces:
  - `type McpAccessLevel = 'NONE' | 'READ' | 'WRITE'`, `const MCP_ACCESS_LEVELS`
  - `mcpRank(level: McpAccessLevel): number` (NONE 0, READ 1, WRITE 2)
  - `hasMcpAccess(have: McpAccessLevel, need: McpAccessLevel): boolean`
  - `parseMcpAccess(value: unknown): McpAccessLevel | undefined` (nur exakt `'NONE'|'READ'|'WRITE'`, sonst `undefined`)
  - `getMcpAccessOf(userId: string): Promise<McpAccessLevel>` (`NONE`, wenn der Benutzer fehlt)
  - `canGrantMcpAccess(currentUser: SessionUser, viewerAccess: McpAccessLevel, target: { homeOrganizationId: string; mcpAccess: McpAccessLevel }, newLevel: McpAccessLevel): boolean`

- [ ] **Step 1: Failing Test für die reinen Helfer**

Create `src/lib/mcp/access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasMcpAccess, mcpRank, parseMcpAccess } from './access';

describe('mcpRank / hasMcpAccess', () => {
  it('ordnet NONE < READ < WRITE', () => {
    expect(mcpRank('NONE')).toBe(0);
    expect(mcpRank('READ')).toBe(1);
    expect(mcpRank('WRITE')).toBe(2);
  });

  it('WRITE schließt READ ein, READ schließt WRITE nicht ein', () => {
    expect(hasMcpAccess('WRITE', 'READ')).toBe(true);
    expect(hasMcpAccess('READ', 'READ')).toBe(true);
    expect(hasMcpAccess('READ', 'WRITE')).toBe(false);
    expect(hasMcpAccess('NONE', 'READ')).toBe(false);
  });
});

describe('parseMcpAccess', () => {
  it('übernimmt exakt die drei gültigen Werte', () => {
    expect(parseMcpAccess('NONE')).toBe('NONE');
    expect(parseMcpAccess('READ')).toBe('READ');
    expect(parseMcpAccess('WRITE')).toBe('WRITE');
  });

  it('liefert undefined für fehlende oder ungültige Werte (nie stillschweigend NONE)', () => {
    expect(parseMcpAccess(null)).toBeUndefined();
    expect(parseMcpAccess(undefined)).toBeUndefined();
    expect(parseMcpAccess('read')).toBeUndefined();
    expect(parseMcpAccess('ADMIN')).toBeUndefined();
    expect(parseMcpAccess(2)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Rot prüfen**

Run: `npx vitest run src/lib/mcp/access.test.ts`
Expected: FAIL (Modul `./access` fehlt).

- [ ] **Step 3: `access.ts` implementieren**

Create `src/lib/mcp/access.ts`:

```ts
/** Stufen des MCP-Zugriffs (spiegelt das Prisma-Enum McpAccess, bleibt aber frei von Datenbank-Importen). */
export const MCP_ACCESS_LEVELS = ['NONE', 'READ', 'WRITE'] as const;
export type McpAccessLevel = (typeof MCP_ACCESS_LEVELS)[number];

const RANK: Record<McpAccessLevel, number> = { NONE: 0, READ: 1, WRITE: 2 };

export function mcpRank(level: McpAccessLevel): number {
  return RANK[level];
}

/** WRITE schließt READ ein. */
export function hasMcpAccess(have: McpAccessLevel, need: McpAccessLevel): boolean {
  return RANK[have] >= RANK[need];
}

/** Nur exakt 'NONE' | 'READ' | 'WRITE'; sonst undefined - ein fehlendes Formularfeld darf nie als NONE gelten. */
export function parseMcpAccess(value: unknown): McpAccessLevel | undefined {
  return typeof value === 'string' && (MCP_ACCESS_LEVELS as readonly string[]).includes(value)
    ? (value as McpAccessLevel)
    : undefined;
}
```

- [ ] **Step 4: `access-db.ts` implementieren**

Create `src/lib/mcp/access-db.ts`:

```ts
import { prisma } from '@/lib/db/prisma';
import type { McpAccessLevel } from './access';

/** Aktuelle MCP-Stufe eines Benutzers aus der Datenbank (NONE, wenn es ihn nicht gibt). */
export async function getMcpAccessOf(userId: string): Promise<McpAccessLevel> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { mcpAccess: true } });
  return row?.mcpAccess ?? 'NONE';
}
```

- [ ] **Step 5: Test grün**

Run: `npx vitest run src/lib/mcp/access.test.ts`
Expected: PASS (4 Tests).

- [ ] **Step 6: Failing Test für `canGrantMcpAccess`**

Create `src/lib/auth/permissions.mcp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/types/next-auth';
import { canGrantMcpAccess } from './permissions';

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u1',
    email: 'u1@example.local',
    name: 'U1',
    homeOrganizationId: 'org-a',
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: 'abschnitt-1',
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

const target = (mcpAccess: 'NONE' | 'READ' | 'WRITE', homeOrganizationId = 'org-a') => ({ homeOrganizationId, mcpAccess });

describe('canGrantMcpAccess', () => {
  it('erlaubt jede Änderung, die nichts ändert (gleiche Stufe)', () => {
    expect(canGrantMcpAccess(user(), 'NONE', target('READ', 'fremd'), 'READ')).toBe(true);
  });

  it('Bezirksadmin darf jedem jede Stufe geben, auch ohne eigene Stufe', () => {
    const admin = user({ isBezirksAdmin: true });
    expect(canGrantMcpAccess(admin, 'NONE', target('NONE', 'irgendwo'), 'WRITE')).toBe(true);
    expect(canGrantMcpAccess(admin, 'NONE', target('WRITE', 'irgendwo'), 'NONE')).toBe(true);
  });

  it('Feuerwehr-Admin mit WRITE darf im eigenen Bereich READ und WRITE vergeben und entziehen', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE'), 'READ')).toBe(true);
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE'), 'WRITE')).toBe(true);
    expect(canGrantMcpAccess(admin, 'WRITE', target('WRITE'), 'NONE')).toBe(true);
  });

  it('Admin mit READ darf READ vergeben, aber weder WRITE vergeben noch einem WRITE-Benutzer die Stufe senken', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'READ', target('NONE'), 'READ')).toBe(true);
    expect(canGrantMcpAccess(admin, 'READ', target('NONE'), 'WRITE')).toBe(false);
    expect(canGrantMcpAccess(admin, 'READ', target('WRITE'), 'READ')).toBe(false);
    expect(canGrantMcpAccess(admin, 'READ', target('WRITE'), 'NONE')).toBe(false);
  });

  it('Admin ohne eigene MCP-Stufe darf nichts vergeben', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'NONE', target('NONE'), 'READ')).toBe(false);
  });

  it('Admin darf nur im eigenen Verwaltungsbereich vergeben', () => {
    const admin = user({ feuerwehrAdminOrgIds: ['org-a'] });
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE', 'org-b'), 'READ')).toBe(false);
  });

  it('Abschnittsadmin erbt über feuerwehrAdminOrgIds die Feuerwehren seines Abschnitts', () => {
    const admin = user({ abschnittAdminOrgIds: ['abschnitt-1'], feuerwehrAdminOrgIds: ['abschnitt-1', 'org-a', 'org-c'] });
    expect(canGrantMcpAccess(admin, 'WRITE', target('NONE', 'org-c'), 'READ')).toBe(true);
  });

  it('ein Mitglied ohne Admin-Recht darf nichts vergeben, auch nicht mit WRITE', () => {
    expect(canGrantMcpAccess(user(), 'WRITE', target('NONE'), 'READ')).toBe(false);
  });
});
```

- [ ] **Step 7: Test laufen lassen, Rot prüfen**

Run: `npx vitest run src/lib/auth/permissions.mcp.test.ts`
Expected: FAIL (`canGrantMcpAccess` ist keine Funktion).

- [ ] **Step 8: `canGrantMcpAccess` in `permissions.ts` ergänzen**

In `src/lib/auth/permissions.ts` oben bei den Imports ergänzen:

```ts
import { mcpRank, type McpAccessLevel } from '@/lib/mcp/access';
```

und direkt nach der Funktion `canManageUserRecord` (vor `canAccessUserManagementAdmin`) einfügen:

```ts
/**
 * Darf currentUser die MCP-Stufe von `target` auf `newLevel` setzen? Bezirksadmin: immer. Sonst nur im eigenen
 * Verwaltungsbereich (canManageUsersFor) UND ohne die eigene Stufe zu überschreiten - weder die neue noch die
 * bisherige Stufe des Ziels darf höher sein als viewerAccess. Ein Admin ohne WRITE kann so weder WRITE vergeben noch
 * einem WRITE-Benutzer die Stufe senken. Gleiche Stufe = keine Änderung = immer erlaubt (damit ein unverändert
 * mitgeschicktes Formularfeld nie eine Prüfung auslöst).
 */
export function canGrantMcpAccess(
  currentUser: SessionUser,
  viewerAccess: McpAccessLevel,
  target: { homeOrganizationId: string; mcpAccess: McpAccessLevel },
  newLevel: McpAccessLevel,
): boolean {
  if (newLevel === target.mcpAccess) return true;
  if (isBezirksAdmin(currentUser)) return true;
  if (!canManageUsersFor(currentUser, target.homeOrganizationId)) return false;
  return mcpRank(newLevel) <= mcpRank(viewerAccess) && mcpRank(target.mcpAccess) <= mcpRank(viewerAccess);
}
```

- [ ] **Step 9: Tests grün, Typprüfung**

Run: `npx vitest run src/lib/auth/permissions.mcp.test.ts src/lib/mcp/access.test.ts` → PASS (12 Tests)
Run: `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 10: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp src/lib/auth/permissions.ts src/lib/auth/permissions.mcp.test.ts
git commit -m "feat: MCP-Zugriffsstufen und canGrantMcpAccess (Vergabe mit Obergrenze)"
```

---

### Task 3: Formular-Schema und Server Actions

**Files:**
- Modify: `src/lib/validation/user.schema.ts`, `src/app/(app)/admin/benutzer/actions.ts`
- Test: `src/lib/validation/user.schema.test.ts`

**Interfaces:**
- Consumes: `parseMcpAccess`, `MCP_ACCESS_LEVELS` (Task 2), `canGrantMcpAccess`, `getMcpAccessOf` (Task 2).
- Produces: `UserInput.mcpAccess?: McpAccessLevel` (optional); `parseUserFormData` liefert `mcpAccess: undefined`, wenn das Feld fehlt/ungültig ist.

- [ ] **Step 1: Failing Test**

Create `src/lib/validation/user.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseUserFormData, userSchema } from './user.schema';

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    firstName: 'Max',
    lastName: 'Muster',
    email: 'max@example.local',
    stbNr: '12',
    homeOrganizationId: 'org-1',
    droneRole: 'NONE',
    ...extra,
  };
  for (const [key, value] of Object.entries(base)) data.set(key, value);
  return data;
}

describe('parseUserFormData - mcpAccess', () => {
  it('liefert undefined, wenn das Feld fehlt (der Server lässt den Wert dann unverändert)', () => {
    expect(parseUserFormData(form()).mcpAccess).toBeUndefined();
  });

  it('übernimmt gültige Werte', () => {
    expect(parseUserFormData(form({ mcpAccess: 'NONE' })).mcpAccess).toBe('NONE');
    expect(parseUserFormData(form({ mcpAccess: 'READ' })).mcpAccess).toBe('READ');
    expect(parseUserFormData(form({ mcpAccess: 'WRITE' })).mcpAccess).toBe('WRITE');
  });

  it('liefert bei ungültigem Wert undefined statt NONE', () => {
    expect(parseUserFormData(form({ mcpAccess: 'ADMIN' })).mcpAccess).toBeUndefined();
  });
});

describe('userSchema - mcpAccess', () => {
  it('akzeptiert das Formular ohne mcpAccess', () => {
    expect(userSchema.safeParse(parseUserFormData(form())).success).toBe(true);
  });

  it('akzeptiert READ und lässt den Wert im Ergebnis stehen', () => {
    const parsed = userSchema.safeParse(parseUserFormData(form({ mcpAccess: 'READ' })));
    expect(parsed.success && parsed.data.mcpAccess).toBe('READ');
  });
});
```

- [ ] **Step 2: Rot prüfen**

Run: `npx vitest run src/lib/validation/user.schema.test.ts`
Expected: FAIL (`mcpAccess` fehlt im Rückgabeobjekt bzw. Schema entfernt das Feld).

- [ ] **Step 3: Schema und Parser erweitern**

In `src/lib/validation/user.schema.ts` oben ergänzen:

```ts
import { MCP_ACCESS_LEVELS, parseMcpAccess } from '@/lib/mcp/access';
```

Im `z.object({ ... })` direkt nach `sendWelcomeEmail: z.boolean(),` einfügen:

```ts
    // Optional: fehlt das Feld (Formular ohne MCP-Abschnitt), bleibt der bestehende Wert unverändert.
    mcpAccess: z.enum(MCP_ACCESS_LEVELS).optional(),
```

In `parseUserFormData` nach der Zeile `sendWelcomeEmail: formData.get('sendWelcomeEmail') === 'on',` einfügen:

```ts
    mcpAccess: parseMcpAccess(formData.get('mcpAccess')),
```

- [ ] **Step 4: Grün**

Run: `npx vitest run src/lib/validation/user.schema.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: Server Actions durchsetzen**

In `src/app/(app)/admin/benutzer/actions.ts`:

(a) Imports ergänzen — bei der Import-Liste aus `@/lib/auth/permissions` den Namen `canGrantMcpAccess` hinzufügen, und neue Zeile:

```ts
import { getMcpAccessOf } from '@/lib/mcp/access-db';
```

(b) In `createUser` direkt nach dem Block `if (data.isBezirksDrohnenAdmin) { assertPermission(canGrantBezirksDrohnenAdmin(currentUser)); }` einfügen:

```ts
  const requestedMcpAccess = data.mcpAccess ?? 'NONE';
  if (requestedMcpAccess !== 'NONE') {
    assertPermission(
      canGrantMcpAccess(
        currentUser,
        await getMcpAccessOf(currentUser.id),
        { homeOrganizationId: data.homeOrganizationId, mcpAccess: 'NONE' },
        requestedMcpAccess,
      ),
      'Keine Berechtigung, dieses MCP-Recht zu vergeben.',
    );
  }
```

und im `prisma.user.create({ data: { ... } })` nach `isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,` einfügen:

```ts
      mcpAccess: requestedMcpAccess,
```

(c) In `updateUser` direkt nach dem Block `if (currentUser.id === userId && targetUser.isBezirksAdmin && !data.isBezirksAdmin) { ... }` einfügen:

```ts
  // Fehlt das Feld (Formular ohne MCP-Abschnitt), bleibt die bisherige Stufe - nie stillschweigend NONE.
  const nextMcpAccess = data.mcpAccess ?? targetUser.mcpAccess;
  if (nextMcpAccess !== targetUser.mcpAccess) {
    assertPermission(
      canGrantMcpAccess(
        currentUser,
        await getMcpAccessOf(currentUser.id),
        { homeOrganizationId: targetUser.homeOrganizationId, mcpAccess: targetUser.mcpAccess },
        nextMcpAccess,
      ),
      'Keine Berechtigung, dieses MCP-Recht zu vergeben.',
    );
  }
```

und im `prisma.user.update({ ... data: { ... } })` nach `isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,` einfügen:

```ts
      mcpAccess: nextMcpAccess,
```

- [ ] **Step 6: Typprüfung**

Run: `npx tsc --noEmit`
Expected: Fehler nur in `user-form-sheet.tsx` (`buildDefaultValues` liefert `UserInput` — `mcpAccess` ist optional, also **keine** Fehler erwartet). Falls doch Fehler: sie dürfen nicht aus `actions.ts` stammen.

- [ ] **Step 7: Commit (nur auf Anweisung)**

```bash
git add src/lib/validation/user.schema.ts src/lib/validation/user.schema.test.ts "src/app/(app)/admin/benutzer/actions.ts"
git commit -m "feat: mcpAccess im Benutzerformular, serverseitig mit canGrantMcpAccess abgesichert"
```

---

### Task 4: Auswahl im Benutzer-Sheet

**Files:**
- Modify: `src/components/admin/user-form-sheet.tsx`, `src/app/(app)/admin/benutzer/user-management-section.tsx`, `src/app/(app)/admin/benutzer/page.tsx`

**Interfaces:**
- Consumes: `McpAccessLevel`, `mcpRank` (Task 2), `getMcpAccessOf` (Task 2).
- Produces: `UserRow.mcpAccess: McpAccessLevel`; `UserSheetTarget.mcpAccess: McpAccessLevel`; Prop `viewerMcpAccess: McpAccessLevel` an `UserManagementSection` und `UserFormSheet`.

Diese Aufgabe ist reine Oberfläche; der Browser-Test hydratisiert React nicht, daher gilt als Nachweis `tsc` + `npm run build` + Sichtprüfung auf DEV.

- [ ] **Step 1: Typen erweitern (`user-management-section.tsx`)**

Oben bei den Imports ergänzen: `import type { McpAccessLevel } from '@/lib/mcp/access';`

Im `export interface UserRow` nach der Zeile `isBezirksDrohnenAdmin: boolean;` (ca. Zeile 73) einfügen: `mcpAccess: McpAccessLevel;`

In der Props-Deklaration der Komponente nach `viewerIsBezirksDrohnenAdmin: boolean;` (ca. Zeile 253) einfügen: `viewerMcpAccess: McpAccessLevel;`

In der Parameter-Destrukturierung nach `viewerIsBezirksDrohnenAdmin,` (ca. Zeile 219) einfügen: `viewerMcpAccess,`

Beim Aufbau von `sheetTarget` (Zeile mit `isBezirksDrohnenAdmin: sheetTargetRow.isBezirksDrohnenAdmin,`, ca. Zeile 648) danach einfügen: `mcpAccess: sheetTargetRow.mcpAccess,`

Beim Aufruf `<UserFormSheet ...>` nach `viewerIsBezirksDrohnenAdmin={viewerIsBezirksDrohnenAdmin}` (ca. Zeile 977) einfügen: `viewerMcpAccess={viewerMcpAccess}`

- [ ] **Step 2: Seite füllt die neuen Werte (`page.tsx`)**

Oben ergänzen: `import { getMcpAccessOf } from '@/lib/mcp/access-db';`

Direkt nach `const viewerIsBezirksDrohnenAdmin = currentUser.isBezirksDrohnenAdmin;` (ca. Zeile 178) einfügen:

```ts
  const viewerMcpAccess = await getMcpAccessOf(currentUser.id);
```

Im Mapping `const rows: UserRow[] = users.map(...)` nach `isBezirksDrohnenAdmin: u.isBezirksDrohnenAdmin,` einfügen: `mcpAccess: u.mcpAccess,`

Beim Aufruf `<UserManagementSection ...>` nach `viewerIsBezirksDrohnenAdmin={viewerIsBezirksDrohnenAdmin}` (ca. Zeile 391) einfügen: `viewerMcpAccess={viewerMcpAccess}`

- [ ] **Step 3: Sheet erweitern (`user-form-sheet.tsx`)**

Imports ergänzen: `import { mcpRank, type McpAccessLevel } from '@/lib/mcp/access';`

In `export interface UserSheetTarget` nach `isBezirksDrohnenAdmin: boolean;` einfügen: `mcpAccess: McpAccessLevel;`

In `interface UserFormSheetProps` nach `viewerIsBezirksDrohnenAdmin: boolean;` einfügen: `viewerMcpAccess: McpAccessLevel;`

Neue Konstante nach `const DRONE_ROLE_LABELS ...` einfügen:

```ts
const MCP_ACCESS_LABELS: Record<McpAccessLevel, string> = {
  NONE: 'Kein',
  READ: 'Lesen',
  WRITE: 'Schreiben',
};
```

In `buildDefaultValues` nach `isBezirksDrohnenAdmin: target?.isBezirksDrohnenAdmin ?? false,` einfügen: `mcpAccess: target?.mcpAccess ?? 'NONE',`

In der Komponente `UserFormSheet` die Prop `viewerMcpAccess` aus den Props destrukturieren (neben `viewerIsBezirksDrohnenAdmin`) und danach (vor dem `return`) berechnen:

```ts
  // Der Abschnitt "KI-Zugriff" erscheint nur, wenn der Betrachter überhaupt etwas vergeben darf; die Server Action
  // prüft canGrantMcpAccess unabhängig davon (die Oberfläche ist nur Bedienkomfort).
  const targetMcpAccess: McpAccessLevel = target?.mcpAccess ?? 'NONE';
  const canEditMcp =
    viewerIsBezirksAdmin || (viewerMcpAccess !== 'NONE' && mcpRank(targetMcpAccess) <= mcpRank(viewerMcpAccess));
  const mcpOptionAllowed = (level: McpAccessLevel) => viewerIsBezirksAdmin || mcpRank(level) <= mcpRank(viewerMcpAccess);
```

Im Submit-Block nach der Zeile `if (values.isBezirksDrohnenAdmin) formData.set('isBezirksDrohnenAdmin', 'on');` einfügen:

```ts
    // Nur senden, wenn der Abschnitt sichtbar war - sonst bleibt die Stufe auf dem Server unverändert.
    if (canEditMcp) formData.set('mcpAccess', values.mcpAccess ?? 'NONE');
```

Im JSX direkt **nach** dem schließenden `</section>` des Abschnitts "Funktionen und Ausbildung" (der Abschnitt mit `<SectionLabel>Funktionen und Ausbildung</SectionLabel>`) einfügen:

```tsx
                {canEditMcp && (
                  <section>
                    <SectionLabel>KI-Zugriff (MCP)</SectionLabel>
                    <div className="rounded-lg border border-line">
                      <div className="flex items-center justify-between gap-3.5 px-3.5 py-3">
                        <div>
                          <div className="text-[15px] font-medium text-ink">Claude / ChatGPT</div>
                          <div className="mt-0.5 text-[13px] text-ink-muted">
                            Zugriff über den MCP-Connector. Die Daten richten sich nach den bestehenden Rechten.
                          </div>
                        </div>
                        <Controller
                          control={control}
                          name="mcpAccess"
                          render={({ field }) => (
                            <SegmentedControl
                              aria-label="MCP-Zugriff"
                              value={field.value ?? 'NONE'}
                              onValueChange={field.onChange}
                              options={(['NONE', 'READ', 'WRITE'] as const).map((level) => ({
                                value: level,
                                label: MCP_ACCESS_LABELS[level],
                                disabled: !mcpOptionAllowed(level),
                              }))}
                            />
                          )}
                        />
                      </div>
                    </div>
                  </section>
                )}
```

- [ ] **Step 4: Typprüfung und Build**

Run: `npx tsc --noEmit` → keine Fehler.
Run: `npm run build` → "Compiled successfully".

- [ ] **Step 5: Sichtprüfung (auf DEV nach Deploy)**

Als Bezirksadmin Benutzer öffnen: Abschnitt "KI-Zugriff (MCP)" sichtbar, alle drei Stufen wählbar, Speichern übernimmt die Stufe. Als Feuerwehr-Admin ohne MCP-Stufe: Abschnitt fehlt. Als Feuerwehr-Admin mit READ: "Schreiben" ist ausgegraut.

- [ ] **Step 6: Commit (nur auf Anweisung)**

```bash
git add src/components/admin/user-form-sheet.tsx "src/app/(app)/admin/benutzer/user-management-section.tsx" "src/app/(app)/admin/benutzer/page.tsx"
git commit -m "feat: KI-Zugriff (MCP) im Benutzer-Sheet mit Obergrenze"
```

---

### Task 5: Funktionsschalter und Seite `/admin/mcp`

**Files:**
- Create: `src/lib/mcp/enabled.ts`, `src/app/(app)/admin/mcp/page.tsx`, `src/app/(app)/admin/mcp/actions.ts`
- Modify: `src/lib/admin/nav-items.ts`
- Test: `src/lib/mcp/enabled.db.test.ts`

**Interfaces:**
- Produces: `isMcpEnabled(): Promise<boolean>`, `setMcpEnabled(enabled: boolean): Promise<void>` (schreibt/aktualisiert die Singleton-Zeile `AppSettings`, `id = 'singleton'`).

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/enabled.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled, setMcpEnabled } from './enabled';

let original: boolean;

beforeAll(async () => {
  original = await isMcpEnabled();
});

afterAll(async () => {
  await setMcpEnabled(original);
  await prisma.$disconnect();
});

describe('mcpEnabled', () => {
  it('lässt sich ein- und ausschalten', async () => {
    await setMcpEnabled(true);
    expect(await isMcpEnabled()).toBe(true);
    await setMcpEnabled(false);
    expect(await isMcpEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Rot**

Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/enabled.db.test.ts`
Expected: FAIL (Modul `./enabled` fehlt).

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/enabled.ts`:

```ts
import { prisma } from '@/lib/db/prisma';

const SETTINGS_ID = 'singleton';

/** Funktionsschalter des MCP-Connectors. Ohne AppSettings-Zeile gilt "aus". */
export async function isMcpEnabled(): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID }, select: { mcpEnabled: true } });
  return settings?.mcpEnabled ?? false;
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, mcpEnabled: enabled },
    update: { mcpEnabled: enabled },
  });
}
```

- [ ] **Step 4: Grün**

Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/enabled.db.test.ts`
Expected: PASS.

- [ ] **Step 5: Server Action**

Create `src/app/(app)/admin/mcp/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission, isBezirksAdmin } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/session';
import { setMcpEnabled } from '@/lib/mcp/enabled';

/** Schaltet den MCP-Connector ein oder aus - nur Bezirksadmin (jede Action prüft selbst, die Seite allein reicht nicht). */
export async function toggleMcpEnabled(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertPermission(isBezirksAdmin(user), 'Nur Bezirksadmins dürfen den MCP-Connector umschalten.');
  await setMcpEnabled(formData.get('enabled') === 'true');
  revalidatePath('/admin/mcp');
}
```

- [ ] **Step 6: Seite**

Create `src/app/(app)/admin/mcp/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { toggleMcpEnabled } from './actions';

// admin/layout.tsx lässt viele Rollen herein - diese Seite bleibt Bezirksadmin-only, daher die eigene Prüfung.
export default async function McpVerwaltungPage() {
  const user = await requireUser();
  const reachableScopes = await getReachableScopes(user);
  if (!isBezirksAdmin(user)) {
    notFound();
  }

  const enabled = await isMcpEnabled();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">KI-Zugriff</h1>

      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />

      <div className="flex max-w-[640px] flex-col gap-4">
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">MCP-Connector für Claude und ChatGPT</h2>
          <p className="mb-3 text-sm text-ink-muted">
            Ist der Connector ausgeschaltet, antworten der Endpunkt und die Anmeldeseiten wie "nicht vorhanden". Wer ihn
            nutzen darf, wird je Benutzer in der Benutzerverwaltung festgelegt ("KI-Zugriff (MCP)").
          </p>
          <p className="mb-3 text-sm font-medium text-ink">
            Status: {enabled ? 'eingeschaltet' : 'ausgeschaltet'}
          </p>
          <form action={toggleMcpEnabled}>
            <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
            <button
              type="submit"
              className="min-h-11 rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              {enabled ? 'Ausschalten' : 'Einschalten'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Navigationseintrag**

In `src/lib/admin/nav-items.ts` den Block

```ts
  if (isBezirksAdmin(user)) {
    items.push({ href: '/admin/email', label: 'E-Mail' }, { href: '/admin/status', label: 'Status' });
  }
```

ersetzen durch:

```ts
  if (isBezirksAdmin(user)) {
    items.push(
      { href: '/admin/email', label: 'E-Mail' },
      { href: '/admin/status', label: 'Status' },
      { href: '/admin/mcp', label: 'KI-Zugriff' },
    );
  }
```

- [ ] **Step 8: Prüfen**

Run: `npx tsc --noEmit` → keine Fehler. Run: `npm run build` → "Compiled successfully", die Route `/admin/mcp` steht in der Liste.

- [ ] **Step 9: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/enabled.ts src/lib/mcp/enabled.db.test.ts "src/app/(app)/admin/mcp" src/lib/admin/nav-items.ts
git commit -m "feat: Funktionsschalter für den MCP-Connector und Seite KI-Zugriff"
```

---

### Task 6: Prüfprotokoll und Mengenbegrenzung

**Files:**
- Create: `src/lib/mcp/audit.ts`, `src/lib/mcp/rate-limit.ts`
- Test: `src/lib/mcp/rate-limit.test.ts`, `src/lib/mcp/audit.db.test.ts`

**Interfaces:**
- Produces:
  - `recordMcpAudit(entry: { userId: string | null; clientId: string | null; tool: string; outcome: 'OK' | 'DENIED' | 'ERROR'; targetUserId?: string | null; summary: string }): Promise<void>` — wirft nie, Fehler gehen ins Log.
  - `countRecentOk(userId: string, tool: string, sinceMs: number, now?: Date): Promise<number>` — Anzahl `OK`-Einträge der letzten `sinceMs` Millisekunden.
  - `checkRateLimit(key: string, max: number, windowMs: number, now?: number): { allowed: boolean; retryAfterSeconds: number }`

- [ ] **Step 1: Failing Test Mengenbegrenzung**

Create `src/lib/mcp/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  it('lässt bis zum Limit durch und sperrt danach, mit Wartezeit', () => {
    const key = `t-${Math.random()}`;
    const t0 = 1_000_000;
    expect(checkRateLimit(key, 2, 60_000, t0).allowed).toBe(true);
    expect(checkRateLimit(key, 2, 60_000, t0 + 1_000).allowed).toBe(true);
    const blocked = checkRateLimit(key, 2, 60_000, t0 + 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(58);
  });

  it('gibt nach Ablauf des Fensters wieder frei', () => {
    const key = `t-${Math.random()}`;
    const t0 = 5_000_000;
    checkRateLimit(key, 1, 10_000, t0);
    expect(checkRateLimit(key, 1, 10_000, t0 + 5_000).allowed).toBe(false);
    expect(checkRateLimit(key, 1, 10_000, t0 + 10_001).allowed).toBe(true);
  });

  it('trennt verschiedene Schlüssel', () => {
    const t0 = 9_000_000;
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    checkRateLimit(a, 1, 60_000, t0);
    expect(checkRateLimit(a, 1, 60_000, t0 + 1).allowed).toBe(false);
    expect(checkRateLimit(b, 1, 60_000, t0 + 1).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Rot**

Run: `npx vitest run src/lib/mcp/rate-limit.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren**

Create `src/lib/mcp/rate-limit.ts`:

```ts
/**
 * Einfache Mengenbegrenzung im Speicher (gleitendes Fenster je Schlüssel). Reicht für den einen App-Container;
 * ein Neustart setzt die Zähler zurück - akzeptiert, die Grenzen schützen vor Schleifen und Missbrauch, nicht
 * vor gezielten Angriffen (dafür gibt es die Anmeldung und die Rechteprüfung).
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    const retryMs = windowMs - (now - recent[0]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}
```

- [ ] **Step 4: Grün**

Run: `npx vitest run src/lib/mcp/rate-limit.test.ts`
Expected: PASS (3 Tests).

- [ ] **Step 5: Failing DB-Test Prüfprotokoll**

Create `src/lib/mcp/audit.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { countRecentOk, recordMcpAudit } from './audit';

const RUN = `mcp-audit-${Date.now()}`;
let userId: string;

beforeAll(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Audit', lastName: RUN, homeOrganizationId: org.id },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.mcpAuditLog.deleteMany({ where: { OR: [{ userId }, { clientId: RUN }] } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('recordMcpAudit / countRecentOk', () => {
  it('schreibt einen Eintrag und zählt nur OK-Einträge des Werkzeugs im Zeitfenster', async () => {
    await recordMcpAudit({ userId, clientId: RUN, tool: 'create_user', outcome: 'OK', summary: 'Benutzer angelegt' });
    await recordMcpAudit({ userId, clientId: RUN, tool: 'create_user', outcome: 'DENIED', summary: 'abgelehnt' });
    await recordMcpAudit({ userId, clientId: RUN, tool: 'list_users', outcome: 'OK', summary: 'x' });
    expect(await countRecentOk(userId, 'create_user', 60_000)).toBe(1);
    // Ein Fenster in der Zukunft (now + 2 h) enthält den Eintrag nicht mehr.
    expect(await countRecentOk(userId, 'create_user', 60_000, new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(0);
  });

  it('wirft nie, auch wenn der Eintrag nicht gespeichert werden kann', async () => {
    await expect(
      recordMcpAudit({ userId: 'gibt-es-nicht', clientId: RUN, tool: 'x', outcome: 'ERROR', summary: 'y' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Rot**

Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/audit.db.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 7: Implementieren**

Create `src/lib/mcp/audit.ts`:

```ts
import { prisma } from '@/lib/db/prisma';

export interface McpAuditEntry {
  userId: string | null;
  clientId: string | null;
  tool: string;
  outcome: 'OK' | 'DENIED' | 'ERROR';
  targetUserId?: string | null;
  /** Kurzer Text OHNE Freitexte (Telefonnummer, Anmerkungen); Namen und E-Mail des Ziels sind erlaubt. */
  summary: string;
}

/** Schreibt einen Prüfprotokoll-Eintrag. Wirft nie: ein Protokollfehler darf die Aktion selbst nicht kippen. */
export async function recordMcpAudit(entry: McpAuditEntry): Promise<void> {
  try {
    await prisma.mcpAuditLog.create({
      data: {
        userId: entry.userId,
        clientId: entry.clientId,
        tool: entry.tool,
        outcome: entry.outcome,
        targetUserId: entry.targetUserId ?? null,
        summary: entry.summary.slice(0, 500),
      },
    });
  } catch (error) {
    console.error('MCP-Prüfprotokoll konnte nicht geschrieben werden:', error);
  }
}

/** Anzahl erfolgreicher Aufrufe eines Werkzeugs durch den Benutzer in den letzten sinceMs Millisekunden. */
export async function countRecentOk(userId: string, tool: string, sinceMs: number, now: Date = new Date()): Promise<number> {
  return prisma.mcpAuditLog.count({
    where: { userId, tool, outcome: 'OK', createdAt: { gt: new Date(now.getTime() - sinceMs) } },
  });
}
```

- [ ] **Step 8: Grün**

Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/audit.db.test.ts`
Expected: PASS (2 Tests).

- [ ] **Step 9: Gesamtprüfung Phase 1**

```bash
npm test
npm run test:db
npx tsc --noEmit
npm run build
```

Expected: alle grün (Unit-Tests: bisherige 142 + 4 + 8 + 5 + 3 = 162; DB-Tests: bisherige 52 + 1 + 2).

- [ ] **Step 10: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp
git commit -m "feat: MCP-Prüfprotokoll und Mengenbegrenzung"
```

## Phase-1-Abnahme

- Migration angewendet, `prisma migrate diff --exit-code` meldet keinen Unterschied.
- Bezirksadmin vergibt in der Benutzerverwaltung READ/WRITE; ein Feuerwehr-Admin ohne MCP-Stufe sieht den Abschnitt nicht; ein Admin mit READ kann kein WRITE vergeben (UI und Server).
- `/admin/mcp` schaltet `mcpEnabled` (nur Bezirksadmin); ein anderer Benutzer bekommt 404.
- Noch kein MCP-Endpunkt: Auslieferung ändert für Mitglieder nichts.
