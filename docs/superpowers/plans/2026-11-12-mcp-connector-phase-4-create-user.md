# MCP-Connector · Phase 4: Benutzer anlegen (`create_user`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Schreibwerkzeug `create_user`, das mit **derselben Kernlogik** wie die Benutzerverwaltung einen neuen Benutzer (Stammdaten plus Rollen) anlegt. Dazu wird die Kernlogik aus der Server Action `createUser` in eine gemeinsame Service-Schicht herausgelöst; die Server Action verhält sich danach unverändert.

**Architecture:** Drei Schritte, jeder für sich prüfbar: (1) gemeinsame Hilfsfunktionen (`syncAdminMemberships`, `syncDroneMembership`, `canGrantAdminFor`, `validateSecondaryOrganizationCategory`) **unverändert** nach `src/lib/users/user-sync.ts` verschieben; (2) `createUserCore(currentUser, data)` in `src/lib/users/create-user.ts` (Rechteprüfungen, Anlegen, Mitgliedschaften, Aktivierungstoken — ohne E-Mail) und `createUser` darauf umstellen; (3) das Werkzeug `create_user` ruft den Kern auf und sendet die Willkommens-Mail.

**Tech Stack:** Next.js Server Actions, Prisma, zod (`userSchema`), vitest (`vi.mock` für die E-Mail).

**Voraussetzung:** Phasen 1–3 sind umgesetzt (`canGrantMcpAccess`, `getMcpAccessOf`, `defineTool`, `runTool`, `countRecentOk`, `recordMcpAudit`, `TOOLS`).

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-connector-design.md`

## Global Constraints

- **Die Server Action `createUser` verhält sich nach dem Umbau identisch** (gleiche Rechteprüfungen in gleicher Reihenfolge, gleiche Fehlermeldungen, gleiche Rückgabewerte, gleiche Weiterleitung). Einzige bewusste Änderung: das Drohnengruppen-Recht wird **vor** dem Anlegen des Benutzers geprüft (bisher erst danach, wodurch bei fehlendem Recht ein Benutzer ohne Mitgliedschaft zurückblieb).
- **Nie über MCP setzbar:** `isBezirksAdmin`, `isBezirksDrohnenAdmin`, `mcpAccess`, zweite Heimatfeuerwehr. Das Werkzeug baut die Eingabe **explizit** aus den erlaubten Feldern (nie `...input`).
- **Neuer Benutzer:** `isActive: false`, Platzhalter-Passwort, Aktivierungstoken (7 Tage). Die Willkommens-Mail geht **immer** an den neuen Benutzer; der Aktivierungslink erscheint nie in der Antwort. Schlägt die Mail fehl, bleibt der Benutzer angelegt (`emailSent: false`).
- **Alle Validierungen** kommen aus `userSchema` (Standesbuchnummer, Telefonformat E.164, Ausbildungs-Reihenfolge, Drohnenrolle braucht Gruppe).
- **Mengenbegrenzung:** höchstens 20 erfolgreich angelegte Benutzer pro Stunde und Benutzer (gezählt über das Prüfprotokoll).
- **Prüfprotokoll:** jeder Aufruf (OK, abgelehnt, Fehler). Die Zusammenfassung enthält Name, E-Mail und Feuerwehr des neuen Benutzers **und die E-Mail des Aufrufers** (`McpAuditLog.userId` wird bei Löschung des Aufrufers `NULL`; so bleibt "wer hat das getan" lesbar), **keine** Telefonnummer.
- **Werkzeug nur ab `WRITE`:** `createMcpServer` registriert es nur für `WRITE`; der Handler prüft die Stufe zusätzlich selbst.
- Übrige Konventionen wie in den Phasen 1–3 (CRLF, Tests, Commits nur auf Anweisung).

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/lib/users/user-sync.ts` (neu) | verschobene Hilfsfunktionen (unverändert) |
| `src/lib/users/create-user.ts` (neu) | `createUserCore` |
| `src/lib/users/create-user.db.test.ts` (neu) | Tests des Kerns |
| `src/app/(app)/admin/benutzer/actions.ts` (ändern) | importiert die Hilfen, `createUser` nutzt den Kern |
| `src/lib/mcp/tools/create-user.ts` (neu) | Werkzeug `create_user` |
| `src/lib/mcp/tools/create-user.db.test.ts` (neu) | Tests des Werkzeugs |
| `src/lib/mcp/tools/index.ts` (ändern) | Registrierung |

---

### Task 1: Hilfsfunktionen in `user-sync.ts` verschieben (Refactoring ohne Verhaltensänderung)

**Files:**
- Create: `src/lib/users/user-sync.ts`
- Modify: `src/app/(app)/admin/benutzer/actions.ts`

**Interfaces:**
- Produces (alle aus `src/lib/users/user-sync.ts`; **Rumpf wortgleich** wie in `actions.ts`, mit einer Ausnahme: `assertGrantMcpAccess` ist neu, siehe Step 2b): `canGrantAdminFor(currentUser: SessionUser, adminOrgIds: string[]): boolean`, `syncAdminMemberships(currentUser: SessionUser, userId: string, adminOrgIds: string[]): Promise<void>`, `type AusbildungsDaten = Record<Ausbildungsstufe, string>`, `syncDroneMembership(currentUser, userId, droneRole: DroneRoleOption, droneGroupId: string | null, ausbildung: AusbildungsDaten): Promise<void>`, `type FieldErrors = Record<string, string[] | undefined>`, `validateSecondaryOrganizationCategory(homeOrganizationId: string, secondaryOrganizationId: string): Promise<FieldErrors | null>`, `assertGrantMcpAccess(currentUser: SessionUser, target: { homeOrganizationId: string; mcpAccess: McpAccessLevel }, newLevel: McpAccessLevel): Promise<void>` (neu).

Dies ist ein **reines Verschieben**. Es gibt keinen neuen Test, weil die Funktionen bisher nicht einzeln aufrufbar waren; ihr Verhalten wird in Task 2 durch Tests des Kerns festgenagelt, und `updateUser` (der sie ebenfalls nutzt) bleibt über `tsc`/`build` und die Sichtprüfung auf DEV abgesichert.

- [ ] **Step 1: Neue Datei anlegen**

Create `src/lib/users/user-sync.ts` mit diesem Kopf und anschließend den **ausgeschnittenen** Funktionen:

```ts
import { DroneRole, MembershipRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  assertPermission,
  canManageDroneGroupFor,
  canManageUsersFor,
  filterRemovableAdminOrgIds,
} from '@/lib/auth/permissions';
import { FEUERWEHR_KATEGORIE_LABEL } from '@/lib/organizations/feuerwehr-kategorie';
import { AUSBILDUNGSSTUFEN, type Ausbildungsstufe, type DroneRoleOption } from '@/lib/validation/user.schema';
import type { SessionUser } from '@/types/next-auth';

export type FieldErrors = Record<string, string[] | undefined>;
```

- [ ] **Step 2: Funktionen aus `actions.ts` ausschneiden und einfügen**

Aus `src/app/(app)/admin/benutzer/actions.ts` die folgenden Deklarationen **samt ihrer Kommentarblöcke** ausschneiden und in dieser Reihenfolge in `user-sync.ts` einfügen. An jeder `function`-/`type`-Deklaration `export` ergänzen, **sonst nichts ändern**:

1. `function canGrantAdminFor(...)` → `export function canGrantAdminFor(...)`
2. `async function syncAdminMemberships(...)` → `export async function ...`
3. `type AusbildungsDaten = ...` → `export type AusbildungsDaten = ...`
4. `function toAusbildungsUpdate(...)` — bleibt **nicht exportiert** (wird nur von `syncDroneMembership` genutzt)
5. `async function syncDroneMembership(...)` → `export async function ...`
6. `async function validateSecondaryOrganizationCategory(...)` → `export async function ...`; in der Signatur den Rückgabetyp `Promise<UserFormState['fieldErrors'] | null>` durch `Promise<FieldErrors | null>` ersetzen (derselbe Typ, ohne Abhängigkeit zur Action-Datei).

- [ ] **Step 2b: Gemeinsamen Helfer für die MCP-Vergabe anlegen und `updateUser` darauf umstellen**

Die Prüfung "darf diese MCP-Stufe vergeben werden?" steht seit Phase 1 inline in `updateUser` und käme sonst ein zweites Mal in `createUserCore` vor. Deshalb **einmal** als Helfer in `user-sync.ts` (neu, nicht verschoben). Imports in `user-sync.ts` ergänzen: in der Liste aus `@/lib/auth/permissions` zusätzlich `canGrantMcpAccess`, außerdem:

```ts
import { getMcpAccessOf } from '@/lib/mcp/access-db';
import type { McpAccessLevel } from '@/lib/mcp/access';
```

und die Funktion anfügen:

```ts
/**
 * Wirft ForbiddenError, wenn currentUser die MCP-Stufe von `target` nicht auf `newLevel` setzen darf
 * (canGrantMcpAccess mit der AKTUELLEN eigenen Stufe aus der Datenbank). Wird NUR aufgerufen, wenn sich die Stufe
 * tatsächlich ändert (bzw. beim Anlegen `newLevel !== 'NONE'`).
 */
export async function assertGrantMcpAccess(
  currentUser: SessionUser,
  target: { homeOrganizationId: string; mcpAccess: McpAccessLevel },
  newLevel: McpAccessLevel,
): Promise<void> {
  assertPermission(
    canGrantMcpAccess(currentUser, await getMcpAccessOf(currentUser.id), target, newLevel),
    'Keine Berechtigung, dieses MCP-Recht zu vergeben.',
  );
}
```

In `actions.ts` (`updateUser`) im Block `if (nextMcpAccess !== targetUser.mcpAccess) { ... }` den vorhandenen Aufruf `assertPermission(canGrantMcpAccess(...), 'Keine Berechtigung, dieses MCP-Recht zu vergeben.');` (Kommentar zur ALTEN Heimat-Organisation davor **behalten**) ersetzen durch:

```ts
    await assertGrantMcpAccess(
      currentUser,
      { homeOrganizationId: targetUser.homeOrganizationId, mcpAccess: targetUser.mcpAccess },
      nextMcpAccess,
    );
```

`assertGrantMcpAccess` zur Importliste aus `@/lib/users/user-sync` in `actions.ts` hinzufügen. Die Importe `canGrantMcpAccess` (aus `@/lib/auth/permissions`) und `getMcpAccessOf` (aus `@/lib/mcp/access-db`) in `actions.ts` entfernen, **sobald** `grep` zeigt, dass sie dort nicht mehr vorkommen.

- [ ] **Step 3: `actions.ts` auf die Importe umstellen**

In `actions.ts` neben den übrigen Importen ergänzen:

```ts
import {
  canGrantAdminFor,
  syncAdminMemberships,
  syncDroneMembership,
  validateSecondaryOrganizationCategory,
} from '@/lib/users/user-sync';
```

Danach nicht mehr verwendete Importe entfernen. Mit `grep` je Name prüfen, ob er in `actions.ts` noch vorkommt, bevor er entfernt wird (z. B. `DroneRole`, `MembershipRole`, `AUSBILDUNGSSTUFEN`, `Ausbildungsstufe`, `DroneRoleOption`, `FEUERWEHR_KATEGORIE_LABEL`, `canManageDroneGroupFor`, `filterRemovableAdminOrgIds` — andere Funktionen der Datei, etwa `approveRegistration`, können einzelne davon noch brauchen).

- [ ] **Step 4: Prüfen**

Run: `npx tsc --noEmit` → keine Fehler.
Run: `npm run build` → "Compiled successfully".
Run: `git diff --stat` → `actions.ts` verliert etwa so viele Zeilen, wie `user-sync.ts` gewinnt (reine Verschiebung); `git diff -w --color-moved=zebra` zeigt die Funktionskörper als "verschoben", nicht als geändert.

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add src/lib/users/user-sync.ts "src/app/(app)/admin/benutzer/actions.ts"
git commit -m "refactor: Hilfsfunktionen der Benutzerverwaltung nach lib/users/user-sync verschoben"
```

---

### Task 2: `createUserCore` und `createUser` darauf umstellen

**Files:**
- Create: `src/lib/users/create-user.ts`
- Modify: `src/app/(app)/admin/benutzer/actions.ts`
- Test: `src/lib/users/create-user.db.test.ts`

**Interfaces:**
- Consumes: Task 1 (inkl. `assertGrantMcpAccess`), `UserInput` (`@/lib/validation/user.schema`), `createToken`, `hashPassword`, `ForbiddenError`.
- Produces:
  - `type CreateUserResult = { ok: true; user: { id: string; email: string; firstName: string; lastName: string }; activationToken: string } | { ok: false; error?: string; fieldErrors?: FieldErrors }`
  - `createUserCore(currentUser: SessionUser, data: UserInput): Promise<CreateUserResult>` — wirft `ForbiddenError` bei fehlendem Recht (wie bisher `assertPermission`); legt **keine** E-Mail an.

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/users/create-user.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { ForbiddenError } from '@/lib/auth/permissions';
import { sessionUserFixture } from '@/lib/mcp/tools/test-support';
import type { UserInput } from '@/lib/validation/user.schema';
import { createUserCore } from './create-user';

const RUN = `cu-core-${Date.now()}`;
let orgA: { id: string };
let orgB: { id: string };
let group: { id: string; organizationId: string };
let actorWrite: string;
let actorNone: string;

const email = (key: string) => `${RUN}-${key}@example.local`;

function input(key: string, overrides: Partial<UserInput> = {}): UserInput {
  return {
    firstName: 'Neu',
    lastName: RUN,
    email: email(key),
    stbNr: '4711',
    phone: '',
    isActive: false,
    istAtemschutzgeraeteTraeger: false,
    dienstgradId: '',
    homeOrganizationId: orgA.id,
    secondaryOrganizationId: '',
    secondaryDienstgradId: '',
    adminOrgIds: [],
    droneRole: 'NONE',
    droneGroupId: null,
    a1a3LizenzAm: '',
    a2LizenzAm: '',
    stuetzpunktausbildungAm: '',
    bos1AusbildungAm: '',
    bos2AusbildungAm: '',
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    sendWelcomeEmail: true,
    ...overrides,
  };
}

const bezirksAdmin = () => sessionUserFixture({ id: 'bezirks', isBezirksAdmin: true });
const feuerwehrAdmin = (id = actorWrite) => sessionUserFixture({ id, homeOrganizationId: orgA.id, feuerwehrAdminOrgIds: [orgA.id] });
const created = (key: string) => prisma.user.findUnique({ where: { email: email(key) } });

beforeAll(async () => {
  [orgA, orgB] = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 2 });
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true } });
  actorWrite = (
    await prisma.user.create({ data: { email: email('actor-write'), passwordHash: 'x', firstName: 'A', lastName: RUN, homeOrganizationId: orgA.id, mcpAccess: 'WRITE' } })
  ).id;
  actorNone = (
    await prisma.user.create({ data: { email: email('actor-none'), passwordHash: 'x', firstName: 'B', lastName: RUN, homeOrganizationId: orgA.id, mcpAccess: 'NONE' } })
  ).id;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.passwordToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.drohnengruppeMembership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('createUserCore', () => {
  it('legt einen inaktiven Benutzer mit Platzhalter-Passwort und Aktivierungstoken an', async () => {
    const result = await createUserCore(bezirksAdmin(), input('basis', { email: email('Basis').toUpperCase() }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await created('basis');
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
    expect(row!.email).toBe(email('basis'));
    expect(row!.passwordHash.length).toBeGreaterThan(20);
    expect(row!.mcpAccess).toBe('NONE');
    const tokens = await prisma.passwordToken.findMany({ where: { userId: row!.id, purpose: 'ACTIVATION' } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).not.toBe(result.activationToken);
    expect(result.user.id).toBe(row!.id);
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs ab und legt nichts an', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('fremd', { homeOrganizationId: orgB.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('fremd')).toBeNull();
  });

  it('lehnt "Admin für" außerhalb des Verwaltungsbereichs ab und legt nichts an', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('adminfremd', { adminOrgIds: [orgB.id] }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('adminfremd')).toBeNull();
  });

  it('lässt Bezirksadmin- und Bezirks-Drohnenadmin-Rechte nur einen Bezirksadmin vergeben', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('ba', { isBezirksAdmin: true }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createUserCore(feuerwehrAdmin(), input('bda', { isBezirksDrohnenAdmin: true, droneRole: 'ADMIN', droneGroupId: group.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('ba')).toBeNull();
    expect(await created('bda')).toBeNull();
  });

  it('legt Admin-Mitgliedschaft, Drohnengruppen-Mitgliedschaft und Ausbildung an', async () => {
    const result = await createUserCore(
      bezirksAdmin(),
      input('voll', { adminOrgIds: [orgA.id], droneRole: 'PILOT', droneGroupId: group.id, a1a3LizenzAm: '2025-01-10', a2LizenzAm: '2025-02-10' }),
    );
    expect(result.ok).toBe(true);
    const row = await created('voll');
    const memberships = await prisma.membership.findMany({ where: { userId: row!.id } });
    expect(memberships.map((m) => m.organizationId)).toEqual([orgA.id]);
    const drone = await prisma.drohnengruppeMembership.findUnique({ where: { userId: row!.id } });
    expect(drone).toMatchObject({ droneGroupId: group.id, role: 'PILOT' });
    expect(drone!.a1a3LizenzAm?.toISOString().slice(0, 10)).toBe('2025-01-10');
    expect(drone!.bos1AusbildungAm).toBeNull();
  });

  it('prüft das Drohnengruppen-Recht VOR dem Anlegen (kein Benutzer ohne Mitgliedschaft)', async () => {
    await expect(createUserCore(feuerwehrAdmin(), input('gruppe', { droneRole: 'PILOT', droneGroupId: group.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('gruppe')).toBeNull();
  });

  it('meldet eine bereits vergebene E-Mail-Adresse (ohne Groß-/Kleinschreibung) als Fehler', async () => {
    await createUserCore(bezirksAdmin(), input('dupe'));
    const result = await createUserCore(bezirksAdmin(), input('dupe2', { email: email('DUPE') }));
    expect(result).toEqual({ ok: false, error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' });
  });

  it('vergibt MCP-Rechte nur mit Obergrenze: Admin ohne eigene Stufe nicht, mit WRITE ja, Bezirksadmin immer', async () => {
    await expect(createUserCore(feuerwehrAdmin(actorNone), input('mcp-none', { mcpAccess: 'READ' }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await created('mcp-none')).toBeNull();

    expect((await createUserCore(feuerwehrAdmin(actorWrite), input('mcp-read', { mcpAccess: 'READ' }))).ok).toBe(true);
    expect((await created('mcp-read'))!.mcpAccess).toBe('READ');

    expect((await createUserCore(bezirksAdmin(), input('mcp-write', { mcpAccess: 'WRITE' }))).ok).toBe(true);
    expect((await created('mcp-write'))!.mcpAccess).toBe('WRITE');
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/users/create-user.db.test.ts` → FAIL (Modul `./create-user` fehlt).

- [ ] **Step 3: Kern implementieren**

Create `src/lib/users/create-user.ts`:

```ts
import crypto from 'crypto';
import { TokenPurpose } from '@prisma/client';
import {
  assertPermission,
  canGrantBezirksAdmin,
  canGrantBezirksDrohnenAdmin,
  canManageDroneGroupFor,
  canManageUsersFor,
} from '@/lib/auth/permissions';
import { createToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/password';
import type { UserInput } from '@/lib/validation/user.schema';
import type { SessionUser } from '@/types/next-auth';
import {
  assertGrantMcpAccess,
  canGrantAdminFor,
  syncAdminMemberships,
  syncDroneMembership,
  validateSecondaryOrganizationCategory,
  type FieldErrors,
} from './user-sync';

export type CreateUserResult =
  | { ok: true; user: { id: string; email: string; firstName: string; lastName: string }; activationToken: string }
  | { ok: false; error?: string; fieldErrors?: FieldErrors };

/**
 * Kernlogik "Benutzer anlegen" - gemeinsam von der Server Action createUser (Benutzerverwaltung) und dem
 * MCP-Werkzeug create_user genutzt, damit beide Wege exakt dieselben Prüfungen durchlaufen. `data` ist bereits
 * mit userSchema validiert. Wirft ForbiddenError bei fehlendem Recht (wie bisher assertPermission) und sendet
 * KEINE E-Mail: der Aufrufer entscheidet, ob er die Willkommens-Mail sendet oder den Link anzeigt.
 */
export async function createUserCore(currentUser: SessionUser, data: UserInput): Promise<CreateUserResult> {
  // Ein Feuerwehr-Admin darf neue Benutzer NUR mit seiner eigenen Feuerwehr als Heimat-Feuerwehr
  // anlegen (siehe canManageUsersFor-Kommentar) - und Admin-Rechte nur für Feuerwehren vergeben,
  // die er selbst verwaltet.
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
  if (data.secondaryOrganizationId) {
    assertPermission(canManageUsersFor(currentUser, data.secondaryOrganizationId));
    const categoryError = await validateSecondaryOrganizationCategory(data.homeOrganizationId, data.secondaryOrganizationId);
    if (categoryError) {
      return { ok: false, fieldErrors: categoryError };
    }
  }
  if (data.isBezirksAdmin) {
    assertPermission(canGrantBezirksAdmin(currentUser));
  }
  if (data.isBezirksDrohnenAdmin) {
    assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
  }
  const requestedMcpAccess = data.mcpAccess ?? 'NONE';
  if (requestedMcpAccess !== 'NONE') {
    await assertGrantMcpAccess(currentUser, { homeOrganizationId: data.homeOrganizationId, mcpAccess: 'NONE' }, requestedMcpAccess);
  }
  // Neu gegenüber der früheren Inline-Fassung: das Recht für die Drohnengruppe wird VOR dem Anlegen geprüft.
  // syncDroneMembership prüft es zwar auch, aber erst nach prisma.user.create - bei fehlendem Recht blieb dadurch
  // ein Benutzer ohne Mitgliedschaft zurück.
  if (data.droneRole !== 'NONE' && data.droneGroupId) {
    const droneGroup = await prisma.droneGroup.findUnique({ where: { id: data.droneGroupId }, select: { id: true, organizationId: true } });
    assertPermission(
      droneGroup !== null && canManageDroneGroupFor(currentUser, droneGroup),
      'Keine Berechtigung, Mitglieder dieser Drohnengruppe zu verwalten.',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    return { ok: false, error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' };
  }

  // Unbenutzbarer Platzhalter-Hash: der Benutzer setzt sein eigenes Passwort über den Aktivierungslink.
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const user = await prisma.user.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      stbNr: data.stbNr || null,
      phone: data.phone || null,
      isActive: false,
      istAtemschutzgeraeteTraeger: data.istAtemschutzgeraeteTraeger,
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      secondaryOrganizationId: data.secondaryOrganizationId || null,
      // Ohne zweite Feuerwehr darf kein Dienstgrad dafür bestehen bleiben - siehe Kommentar bei
      // updateUser, dieselbe Regel gilt hier fürs Anlegen.
      secondaryDienstgradId: data.secondaryOrganizationId ? data.secondaryDienstgradId || null : null,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
      mcpAccess: requestedMcpAccess,
      passwordHash,
    },
  });

  await syncAdminMemberships(currentUser, user.id, data.adminOrgIds);
  await syncDroneMembership(currentUser, user.id, data.droneRole, data.droneGroupId, {
    a1a3LizenzAm: data.a1a3LizenzAm,
    a2LizenzAm: data.a2LizenzAm,
    stuetzpunktausbildungAm: data.stuetzpunktausbildungAm,
    bos1AusbildungAm: data.bos1AusbildungAm,
    bos2AusbildungAm: data.bos2AusbildungAm,
  });

  const activationToken = await createToken(user.id, TokenPurpose.ACTIVATION);
  return { ok: true, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }, activationToken };
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/users/create-user.db.test.ts` → PASS (8 Tests). `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 5: `createUser` in `actions.ts` auf den Kern umstellen**

In `src/app/(app)/admin/benutzer/actions.ts` die komplette Funktion `createUser` **ersetzen** durch:

```ts
export async function createUser(_prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  const currentUser = await requireUser();

  const raw = parseUserFormData(formData);
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // Rechteprüfungen, Anlegen, Mitgliedschaften und Aktivierungstoken: gemeinsame Kernlogik (auch vom MCP-Werkzeug
  // create_user genutzt). ForbiddenError wird wie bisher nicht abgefangen.
  const result = await createUserCore(currentUser, data);
  if (!result.ok) {
    return result.fieldErrors ? { fieldErrors: result.fieldErrors } : { error: result.error };
  }
  const { user, activationToken: token } = result;

  if (!data.sendWelcomeEmail) {
    // Kein Mail-Versand gewünscht: Aktivierungslink stattdessen dem Admin zum manuellen Weitergeben anzeigen.
    revalidatePath('/admin/benutzer');
    return { success: true, activationLink: `${baseUrl()}/aktivieren/${token}` };
  }

  try {
    await sendActivationEmail(user, token);
  } catch (error) {
    console.error('Fehler beim Senden der Aktivierungs-E-Mail:', error);
    return {
      error:
        'Benutzer wurde angelegt, aber die Aktivierungs-E-Mail konnte nicht gesendet werden. Bitte Mailjet-Konfiguration prüfen.',
    };
  }

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}
```

und oben `import { createUserCore } from '@/lib/users/create-user';` ergänzen. Danach nicht mehr benutzte Importe entfernen (mit `grep` je Name prüfen): voraussichtlich `crypto`, `hashPassword`, `createToken`/`TokenPurpose` (falls `sendPasswordResetEmailToUser` sie noch braucht, bleiben sie), `canGrantBezirksAdmin`, `canGrantBezirksDrohnenAdmin` (werden von `updateUser` weiter gebraucht — bleiben), `getMcpAccessOf`/`canGrantMcpAccess` (seit Task 1 Step 2b nur noch im Helfer `assertGrantMcpAccess`, in `actions.ts` also entfernen, falls `grep` keine Verwendung mehr zeigt).

- [ ] **Step 6: Prüfen**

Run: `npx tsc --noEmit` → keine Fehler. Run: `npm run build` → "Compiled successfully". Run: `npm run test:db` → alle grün.

Sichtprüfung (lokal oder DEV): in der Benutzerverwaltung einen Benutzer **mit** Willkommens-Mail anlegen (Weiterleitung zur Liste, Benutzer erscheint als "Inaktiv"), einen **ohne** Willkommens-Mail (Aktivierungslink erscheint), und als Feuerwehr-Admin versuchen, einen Benutzer einer fremden Feuerwehr per Formular anzulegen (wird wie bisher abgelehnt).

- [ ] **Step 7: Commit (nur auf Anweisung)**

```bash
git add src/lib/users/create-user.ts src/lib/users/create-user.db.test.ts "src/app/(app)/admin/benutzer/actions.ts"
git commit -m "refactor: Kernlogik 'Benutzer anlegen' in createUserCore, Server Action nutzt sie"
```

---

### Task 3: Werkzeug `create_user`

**Files:**
- Create: `src/lib/mcp/tools/create-user.ts`
- Modify: `src/lib/mcp/tools/index.ts`
- Test: `src/lib/mcp/tools/create-user.db.test.ts`

**Interfaces:**
- Consumes: `createUserCore`, `userSchema`, `UserInput`, `sendActivationEmail` (`@/lib/email/templates`), `countRecentOk`, `canAccessUserManagementAdmin`, `ForbiddenError`, `hasMcpAccess`, `denied`, `invalid`.
- Produces: `createUserTool` (`ToolDefinition`, `access: 'WRITE'`) → `{ userId, name, email, heimatfeuerwehr, emailSent, hinweis? }` mit `audit: { targetUserId, summary }`; `CREATE_USER_PER_HOUR = 20`.

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/tools/create-user.db.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Die Willkommens-Mail darf in Tests nie wirklich versendet werden.
const sendActivationEmail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/email/templates', () => ({ sendActivationEmail }));

import { prisma } from '@/lib/db/prisma';
import { recordMcpAudit } from '../audit';
import { principalFixture, sessionUserFixture } from './test-support';
import { CREATE_USER_PER_HOUR, createUserTool } from './create-user';
import { runTool } from './run';

const RUN = `mcp-cu-${Date.now()}`;
let orgA: { id: string; name: string };
let orgB: { id: string };
let group: { id: string };
let actorId: string;

const email = (key: string) => `${RUN}-${key}@example.local`;
const baseArgs = (key: string, extra: Record<string, unknown> = {}) => ({
  firstName: 'Neu',
  lastName: RUN,
  email: email(key),
  stbNr: '4711',
  homeOrganizationId: orgA.id,
  ...extra,
});
const principal = (overrides = {}, access: 'READ' | 'WRITE' = 'WRITE') =>
  principalFixture(sessionUserFixture({ id: actorId, homeOrganizationId: orgA.id, feuerwehrAdminOrgIds: [orgA.id], ...overrides }), access);
const run = (key: string, extra: Record<string, unknown> = {}, p = principal()) => createUserTool.handler({ principal: p }, baseArgs(key, extra));
const created = (key: string) => prisma.user.findUnique({ where: { email: email(key) } });

beforeAll(async () => {
  [orgA, orgB] = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true }, orderBy: { name: 'asc' }, take: 2 });
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' } });
  actorId = (await prisma.user.create({ data: { email: email('actor'), passwordHash: 'x', firstName: 'Akteur', lastName: RUN, homeOrganizationId: orgA.id, mcpAccess: 'WRITE' } })).id;
});

beforeEach(() => {
  sendActivationEmail.mockClear();
  sendActivationEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.mcpAuditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.drohnengruppeMembership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('create_user', () => {
  it('legt den Benutzer an, sendet die Willkommens-Mail und gibt nie den Aktivierungslink aus', async () => {
    const result = await run('ok');
    const row = await created('ok');
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
    const [recipient, token] = sendActivationEmail.mock.calls[0] as unknown as [{ email: string }, string];
    expect(recipient.email).toBe(email('ok'));
    expect(token.length).toBeGreaterThan(20);

    const data = result.data as { userId: string; emailSent: boolean };
    expect(data.userId).toBe(row!.id);
    expect(data.emailSent).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.audit).toMatchObject({ targetUserId: row!.id });
    expect(result.audit!.summary).toContain(email('ok'));
    expect(result.audit!.summary).toContain('durch ');
  });

  it('legt Rollen an: Admin für die eigene Feuerwehr, Drohnengruppen-Mitglied mit Ausbildung (als Bezirksadmin)', async () => {
    const admin = principal({ feuerwehrAdminOrgIds: [], isBezirksAdmin: true });
    await run('rollen', { adminOrgIds: [orgA.id], droneRole: 'PILOT', droneGroupId: group.id, ausbildung: { a1a3Lizenz: '2025-01-10' }, istAtemschutzgeraeteTraeger: true }, admin);
    const row = await created('rollen');
    expect(row!.istAtemschutzgeraeteTraeger).toBe(true);
    expect(await prisma.membership.count({ where: { userId: row!.id } })).toBe(1);
    expect(await prisma.drohnengruppeMembership.count({ where: { userId: row!.id, droneGroupId: group.id } })).toBe(1);
  });

  it('kann keine Bezirks- oder MCP-Rechte setzen, auch wenn sie im Aufruf mitgeschickt werden', async () => {
    const admin = principal({ feuerwehrAdminOrgIds: [], isBezirksAdmin: true });
    await run('rechte', { isBezirksAdmin: true, isBezirksDrohnenAdmin: true, mcpAccess: 'WRITE' }, admin);
    const row = await created('rechte');
    expect(row).toMatchObject({ isBezirksAdmin: false, isBezirksDrohnenAdmin: false, mcpAccess: 'NONE' });
  });

  it('lehnt Aufrufer ohne WRITE-Stufe und Mitglieder ohne Verwaltungsrecht ab', async () => {
    await expect(run('read', {}, principal({}, 'READ'))).rejects.toMatchObject({ kind: 'denied' });
    await expect(run('member', {}, principalFixture(sessionUserFixture({ id: actorId }), 'WRITE'))).rejects.toMatchObject({ kind: 'denied' });
    expect(await created('read')).toBeNull();
    expect(await created('member')).toBeNull();
  });

  it('lehnt eine Feuerwehr außerhalb des Verwaltungsbereichs und unbekannte Feuerwehren ab', async () => {
    await expect(run('fremd', { homeOrganizationId: orgB.id })).rejects.toMatchObject({ kind: 'denied' });
    await expect(run('unbekannt', { homeOrganizationId: 'gibt-es-nicht' }, principal({ feuerwehrAdminOrgIds: [], isBezirksAdmin: true }))).rejects.toMatchObject({ kind: 'invalid' });
    expect(await created('fremd')).toBeNull();
    expect(await created('unbekannt')).toBeNull();
  });

  it('lehnt "Admin für" und Drohnengruppen ohne Recht ab und legt dann nichts an', async () => {
    await expect(run('adminfremd', { adminOrgIds: [orgB.id] })).rejects.toMatchObject({ kind: 'denied' });
    await expect(run('gruppe', { droneRole: 'PILOT', droneGroupId: group.id })).rejects.toMatchObject({ kind: 'denied' });
    expect(await created('adminfremd')).toBeNull();
    expect(await created('gruppe')).toBeNull();
  });

  it('meldet ungültige Eingaben mit lesbarer Meldung (Standesbuchnummer, Telefon, Rolle ohne Gruppe, Ausbildungsreihenfolge)', async () => {
    await expect(run('stb', { stbNr: '0123' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('Standesbuchnummer') });
    await expect(run('tel', { phone: '0660123' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('E.164') });
    await expect(run('rolle', { droneRole: 'PILOT' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('Drohnengruppe') });
    await expect(run('reihe', { droneRole: 'PILOT', droneGroupId: group.id, ausbildung: { bos1: '2025-04-01' } }, principal({ feuerwehrAdminOrgIds: [], isBezirksAdmin: true }))).rejects.toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('der Reihe nach'),
    });
    await expect(run('dienstgrad', { dienstgradId: 'gibt-es-nicht' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('Dienstgrad') });
  });

  it('meldet eine bereits vergebene E-Mail-Adresse', async () => {
    await run('doppelt');
    await expect(run('doppelt')).rejects.toMatchObject({ kind: 'invalid', message: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' });
  });

  it('behält den Benutzer, wenn die Mail nicht gesendet werden kann, und sagt das ehrlich', async () => {
    sendActivationEmail.mockRejectedValueOnce(new Error('Mailjet down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await run('mailfehler');
    spy.mockRestore();
    expect(await created('mailfehler')).not.toBeNull();
    expect(result.data).toMatchObject({ emailSent: false });
    expect((result.data as { hinweis: string }).hinweis).toContain('Passwort-Reset');
  });
});

describe('create_user über runTool (Prüfprotokoll)', () => {
  it('protokolliert eine verweigerte Anlage als DENIED und eine erfolgreiche als OK', async () => {
    const audit = vi.fn(async () => undefined);
    await runTool(principal(), createUserTool, baseArgs('audit-denied', { homeOrganizationId: orgB.id }), { audit });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'create_user', outcome: 'DENIED' }));
    await runTool(principal(), createUserTool, baseArgs('audit-ok'), { audit });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'create_user', outcome: 'OK', targetUserId: expect.any(String) }));
  });
});

// Muss ZULETZT stehen: der Test reizt die Stundengrenze für actorId aus, danach wäre jede weitere Anlage gesperrt.
describe('create_user Mengenbegrenzung', () => {
  it('begrenzt auf 20 neu angelegte Benutzer pro Stunde (gezählt über das Prüfprotokoll)', async () => {
    for (let i = 0; i < CREATE_USER_PER_HOUR; i++) {
      await recordMcpAudit({ userId: actorId, clientId: 'mcp_test', tool: 'create_user', outcome: 'OK', summary: 'x' });
    }
    await expect(run('limit')).rejects.toMatchObject({ kind: 'denied', message: expect.stringContaining('Mengenbegrenzung') });
    expect(await created('limit')).toBeNull();
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/create-user.db.test.ts` → FAIL (Modul `./create-user` fehlt).

- [ ] **Step 3: Werkzeug implementieren**

Create `src/lib/mcp/tools/create-user.ts`:

```ts
import { z } from 'zod';
import { ForbiddenError, canAccessUserManagementAdmin } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { sendActivationEmail } from '@/lib/email/templates';
import { createUserCore } from '@/lib/users/create-user';
import { userSchema, type UserInput } from '@/lib/validation/user.schema';
import { hasMcpAccess } from '../access';
import { countRecentOk } from '../audit';
import { denied, invalid } from './context';
import { defineTool } from './define';

export const CREATE_USER_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format YYYY-MM-DD');

function formatFieldErrors(fieldErrors: Record<string, string[] | undefined>): string {
  return Object.entries(fieldErrors)
    .map(([field, messages]) => `${field}: ${(messages ?? []).join(', ')}`)
    .join('; ');
}

export const createUserTool = defineTool({
  name: 'create_user',
  description:
    'Benutzerverwaltung: legt einen neuen Benutzer an (Stammdaten, Heimatfeuerwehr, optional Dienstgrad, Atemschutzgeräteträger, Admin für Feuerwehren, Drohnengruppen-Rolle, Ausbildungsstufen). ' +
    'Der Benutzer erhält eine Willkommens-E-Mail mit Aktivierungslink (der Link erscheint hier nie). ' +
    'Nur im eigenen Verwaltungsbereich. Nicht möglich: Bezirksadmin, Bezirks-Drohnenadmin und MCP-Zugriff vergeben - das geschieht nur in der Benutzerverwaltung.',
  access: 'WRITE',
  inputSchema: {
    firstName: z.string().min(1).max(100).describe('Vorname'),
    lastName: z.string().min(1).max(100).describe('Nachname'),
    email: z.string().email().describe('E-Mail-Adresse (an sie geht der Aktivierungslink)'),
    stbNr: z.string().min(1).max(50).describe('Standesbuchnummer: nur Ziffern, nicht mit 0 beginnend'),
    phone: z.string().max(20).optional().describe('Telefon im Format E.164, z. B. +436601234567'),
    homeOrganizationId: z.string().min(1).describe('ID der Heimatfeuerwehr (aus list_organizations)'),
    dienstgradId: z.string().optional().describe('ID aus list_dienstgrade'),
    istAtemschutzgeraeteTraeger: z.boolean().optional(),
    adminOrgIds: z.array(z.string()).max(20).optional().describe('Feuerwehren, für die der Benutzer Admin wird (nur im eigenen Verwaltungsbereich)'),
    droneGroupId: z.string().optional().describe('Drohnengruppe (nur zusammen mit droneRole)'),
    droneRole: z.enum(['PILOT', 'ADMIN']).optional().describe('Rolle in der Drohnengruppe'),
    ausbildung: z
      .object({ a1a3Lizenz: date.optional(), a2Lizenz: date.optional(), stuetzpunktausbildung: date.optional(), bos1: date.optional(), bos2: date.optional() })
      .optional()
      .describe('Ausbildungsstufen der Drohnengruppe, der Reihe nach (A1/A3, A2, Stützpunkt, BOS1, BOS2)'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    if (!hasMcpAccess(principal.access, 'WRITE')) throw denied('Für dieses Werkzeug ist der Schreibzugriff (MCP Write) erforderlich.');
    if (!canAccessUserManagementAdmin(user)) throw denied('Keine Berechtigung: Benutzer anlegen dürfen nur Admins.');
    if ((await countRecentOk(user.id, 'create_user', HOUR_MS)) >= CREATE_USER_PER_HOUR) {
      throw denied(`Mengenbegrenzung: höchstens ${CREATE_USER_PER_HOUR} neue Benutzer pro Stunde.`);
    }

    const organization = await prisma.organization.findUnique({ where: { id: input.homeOrganizationId }, select: { name: true, shortName: true } });
    if (!organization) throw invalid('Feuerwehr wurde nicht gefunden.');
    if (input.dienstgradId && !(await prisma.dienstgrad.findUnique({ where: { id: input.dienstgradId }, select: { id: true } }))) {
      throw invalid('Dienstgrad wurde nicht gefunden.');
    }

    // Die Eingabe wird EXPLIZIT aus den erlaubten Feldern gebaut (nie ...input): Bezirksadmin, Bezirks-Drohnenadmin,
    // mcpAccess und zweite Heimatfeuerwehr sind hier bewusst nicht setzbar.
    const raw: UserInput = {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      stbNr: input.stbNr,
      phone: input.phone ?? '',
      isActive: false,
      istAtemschutzgeraeteTraeger: input.istAtemschutzgeraeteTraeger ?? false,
      dienstgradId: input.dienstgradId ?? '',
      homeOrganizationId: input.homeOrganizationId,
      secondaryOrganizationId: '',
      secondaryDienstgradId: '',
      adminOrgIds: input.adminOrgIds ?? [],
      droneRole: input.droneRole ?? 'NONE',
      droneGroupId: input.droneGroupId ?? null,
      a1a3LizenzAm: input.ausbildung?.a1a3Lizenz ?? '',
      a2LizenzAm: input.ausbildung?.a2Lizenz ?? '',
      stuetzpunktausbildungAm: input.ausbildung?.stuetzpunktausbildung ?? '',
      bos1AusbildungAm: input.ausbildung?.bos1 ?? '',
      bos2AusbildungAm: input.ausbildung?.bos2 ?? '',
      isBezirksAdmin: false,
      isBezirksDrohnenAdmin: false,
      sendWelcomeEmail: true,
      mcpAccess: undefined,
    };
    const parsed = userSchema.safeParse(raw);
    if (!parsed.success) throw invalid(formatFieldErrors(parsed.error.flatten().fieldErrors));

    let result;
    try {
      result = await createUserCore(user, parsed.data);
    } catch (error) {
      if (error instanceof ForbiddenError) throw denied(error.message);
      throw error;
    }
    if (!result.ok) throw invalid(result.error ?? formatFieldErrors(result.fieldErrors ?? {}));

    // Die Willkommens-Mail geht immer an den neuen Benutzer; der Link erscheint nie in der Antwort. Ein Mailfehler
    // macht die Anlage nicht rückgängig.
    let emailSent = true;
    try {
      await sendActivationEmail(result.user, result.activationToken);
    } catch (error) {
      emailSent = false;
      console.error('MCP create_user: Aktivierungs-E-Mail konnte nicht gesendet werden:', error);
    }

    const organizationName = organization.shortName ?? organization.name;
    return {
      data: {
        userId: result.user.id,
        name: `${result.user.lastName} ${result.user.firstName}`,
        email: result.user.email,
        heimatfeuerwehr: organizationName,
        emailSent,
        ...(emailSent
          ? {}
          : {
              hinweis:
                'Der Benutzer wurde angelegt, aber die Willkommens-E-Mail konnte nicht gesendet werden. In der Benutzerverwaltung lässt sich eine Passwort-Reset-E-Mail auslösen.',
            }),
      },
      audit: {
        targetUserId: result.user.id,
        summary: `Benutzer angelegt: ${result.user.firstName} ${result.user.lastName} <${result.user.email}> (${organizationName}), durch ${user.email}`,
      },
    };
  },
});
```

In `src/lib/mcp/tools/index.ts` ergänzen: `import { createUserTool } from './create-user';` und `createUserTool` in die Liste `TOOLS` aufnehmen.

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/tools/create-user.db.test.ts` → PASS (11 Tests). `npx tsc --noEmit` → keine Fehler.

Falls `vi.mock` den Import von `sendActivationEmail` nicht abfängt (Test sendet dann wirklich per Mailjet), **sofort abbrechen**: dann importiert das Werkzeug die Funktion über einen anderen Pfad als `@/lib/email/templates`. Den Import im Werkzeug an den Mock-Pfad angleichen, nicht umgekehrt, und erst dann erneut laufen lassen.

- [ ] **Step 5: Registrierung prüfen**

In `src/app/api/mcp/route.db.test.ts` im Test "listet mit gültigem Token die Werkzeuge der Stufe" nach `expect(names).not.toContain('create_user');` nichts ändern (der Test nutzt ein READ-Token). Zusätzlich einen Test ergänzen, der mit einem WRITE-Token `create_user` sieht: Benutzer mit `mcpAccess: 'WRITE'` anlegen, `issueTestToken` aufrufen, `tools/list` senden und `expect(names).toContain('create_user')`. Run: `npx vitest run -c vitest.db.config.ts src/app/api/mcp/route.db.test.ts` → PASS.

- [ ] **Step 6: Gesamtprüfung Phase 4**

```bash
npm test
npm run test:db
npx tsc --noEmit
npm run build
```

Expected: alles grün.

- [ ] **Step 7: Manuelle Prüfung mit dem Inspector (lokal)**

Wie in Phase 3 Task 9 verbinden, diesmal mit einem Benutzer mit `WRITE`, der Feuerwehr-Admin ist. `tools/list` zeigt `create_user`. `create_user` mit `firstName`, `lastName`, `email` (eine echte, erreichbare Testadresse), `stbNr`, `homeOrganizationId` der eigenen Feuerwehr aufrufen. Erwartung: Antwort mit `userId` und `emailSent: true`, der Benutzer erscheint in der Benutzerverwaltung als "Inaktiv", die Willkommens-Mail kommt an, im Prüfprotokoll steht ein `OK`-Eintrag (`SELECT tool, outcome, summary FROM "McpAuditLog" ORDER BY "createdAt" DESC LIMIT 3;` in `npx prisma studio` oder `psql`). Mit einer fremden `homeOrganizationId`: Fehler "Keine Berechtigung …" und ein `DENIED`-Eintrag.

- [ ] **Step 8: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/tools src/app/api/mcp/route.db.test.ts
git commit -m "feat: MCP-Werkzeug create_user (Stammdaten plus Rollen, Willkommens-Mail, Prüfprotokoll)"
```

## Phase-4-Abnahme

- `createUser` der Benutzerverwaltung verhält sich unverändert (Mail, Link-Anzeige, Fehlermeldungen); der Kern wird von beiden Wegen genutzt.
- `create_user` ist nur mit `WRITE` sichtbar, legt Benutzer nur im eigenen Verwaltungsbereich an, setzt nie Bezirksadmin/Bezirks-Drohnenadmin/`mcpAccess`, sendet immer die Willkommens-Mail, zeigt nie den Link, protokolliert jeden Aufruf und ist auf 20 pro Stunde begrenzt.
