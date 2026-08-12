# Bezirksverwaltung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new admin module "Bezirksverwaltung" (`/admin/bezirksverwaltung`) that lets a
Bezirksadmin create/rename/deactivate-reactivate Feuerwehren and Drohnengruppen (currently only
possible via `prisma/seed.ts`), and lets a Bezirksadmin or Bezirks-Drohnenadmin see a read-only list
of all Bezirksadmins.

**Architecture:** Two new, additive `isActive Boolean @default(true)` columns (`Organization`,
`DroneGroup`) back the deactivate/reactivate toggle — no hard-delete, no cascading to `User`/
`Membership`/`DrohnengruppeMembership`. Three new permission predicates gate the page and its two
manageable sections independently, following this codebase's established plain-predicate-function
convention (no RBAC library). New-assignment pickers elsewhere in the app (Kalender's Organisation/
Drohnengruppe selects, `UserFormSheet`'s Heimat-Feuerwehr select, News' audience pickers) start
excluding deactivated entries from new choices while still rendering an already-assigned deactivated
entry correctly — implemented once, centrally, in `OrgSearchSelect` and `getManageableDroneGroupOptions`,
not duplicated per call site.

**Tech Stack:** Next.js App Router (Server Components/Actions), Prisma, zod, shadcn `Table`/`Badge`
(this module's own established mixed convention: shadcn for display, hand-rolled `<form>`/`<select>`
for the interactive create/rename/toggle bits — see `/admin/drohnen/page.tsx`, the closest sibling
module, for the exact precedent this plan follows throughout).

## Global Constraints

- **No hard-delete anywhere.** Deactivate (`isActive = false`) / reactivate (`isActive = true`) only.
- **No cascading.** Deactivating a Feuerwehr/Drohnengruppe never touches `User`, `Membership`, or
  `DrohnengruppeMembership` rows.
- **`Organization.nummer` is immutable after creation** — no UI element in this module may edit it.
- **No new Abschnittskommandos.** The 7 Abschnitte stay fixed/seed-only; the Feuerwehren-create form's
  `type` is always hard-coded to `FEUERWEHR`.
- **Every Server Action re-checks permissions independently of the page-level gate** — the established,
  non-negotiable convention in this codebase (see any existing `admin/*/actions.ts`).
- **No automated test suite in this repo.** Verify each task with `npx tsc --noEmit`, `npm run build`,
  and the manual/scripted check each task specifies — never introduce a pytest/jest-style test file.

---

## File Structure

**New files:**
- `src/lib/validation/bezirksverwaltung.schema.ts` — zod schemas for create/rename of both entities.
- `src/app/(app)/admin/bezirksverwaltung/actions.ts` — the 6 Server Actions.
- `src/app/(app)/admin/bezirksverwaltung/page.tsx` — server component: gate, data loading, assembling
  the three sections.
- `src/app/(app)/admin/bezirksverwaltung/feuerwehren-table.tsx` — client component: search input +
  Abschnitt-grouped table, renders the two client forms below per row/at the bottom.
- `src/app/(app)/admin/bezirksverwaltung/rename-feuerwehr-form.tsx` — client, inline 2-field rename
  (Name + Kurzname), `useActionState`, directly modeled on the existing `RenameDroneForm`.
- `src/app/(app)/admin/bezirksverwaltung/add-feuerwehr-form.tsx` — client, inline 4-field create
  (Name/Kurzname/Nummer/Abschnitt), `useActionState`, directly modeled on `AddDroneForm`.
- `src/app/(app)/admin/bezirksverwaltung/rename-drone-group-form.tsx` — client, inline 1-field rename.
- `src/app/(app)/admin/bezirksverwaltung/add-drone-group-form.tsx` — client, inline 2-field create
  (Name/Abschnitt).

**Modified files:**
- `prisma/schema.prisma` — add `isActive` to `Organization` and `DroneGroup`.
- `src/lib/auth/permissions.ts` — 3 new exported functions.
- `src/lib/admin/nav-items.ts` — 1 new nav entry.
- `src/components/admin/org-search-select.tsx` — `isActive`-aware exclusion (shared by every
  `OrgSearchSelect` consumer at once, including the Heimat-Feuerwehr picker).
- `src/app/(app)/admin/benutzer/user-management-section.tsx` — thread `isActive` through the local
  `Organization` interface (needed so `admin/benutzer/page.tsx`'s new literal doesn't trip an excess-
  property-check error; `AdminOrgMultiSelect`/"Admin für" stays functionally untouched — out of scope,
  see Task 6).
- `src/app/(app)/admin/benutzer/page.tsx` — pass `isActive` through the existing `organizations` mapping.
- `src/components/admin/user-form-sheet.tsx` — `OrganizationOption` gains `isActive?: boolean` (typing
  only, no logic change — the component already forwards `organizations` straight into `OrgSearchSelect`).
- `src/lib/calendar/drone-group-options.ts` — `getManageableDroneGroupOptions` filters on `isActive`,
  with an explicit current-value carve-out for the edit flow.
- `src/components/calendar/event-form.tsx` — `OrganizationOption` gains `isActive?: boolean`; the
  Organisation `<option>` label appends "(deaktiviert)" when inactive.
- `src/app/(app)/kalender/neu/page.tsx` — Organisation query filters on `isActive: true`.
- `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx` — Organisation query filters on `isActive`
  with a current-value carve-out; `getManageableDroneGroupOptions` called with the event's current
  `droneGroupId`.
- `src/app/(app)/news/neu/page.tsx` — both audience queries filter on `isActive: true` (pure create
  flow, no carve-out needed).

**Explicitly NOT modified** (design §8's stated exceptions — management views of *existing*
assignments, not new-assignment pickers): `admin/heimatfeuerwehr/page.tsx`'s own org-switcher,
`admin/drohnen/page.tsx`'s group-switcher, `admin/drohnen/einsatzbereitschaft/page.tsx`,
`lib/drone/flightbook-groups.ts`, `kalender/page.tsx`'s internal `droneGroupsById` lookup,
`lib/admin/scope.ts`'s Geltungsbereich-Wähler, `lib/auth/build-session-user.ts`'s permission
computation, `(app)/layout.tsx`'s `adminOrganizations` display, `admin/benutzer/import/actions.ts`'s
bulk-import org lookup (data reconciliation, not a picker — stays permissive), and the three
background cron routes (`notify-atemschutz-warnung.ts`, `kalender-ics-sync/route.ts`,
`facebook-fetch/route.ts` — not pickers, out of scope). `AdminOrgMultiSelect`/"Admin für" is also
deliberately left untouched — the design's §8 enumeration names only the Heimat-Feuerwehr picker.

---

### Task 1: Schema, permissions, nav entry

**Files:**
- Modify: `prisma/schema.prisma` (the `Organization` model, and the `DroneGroup` model).
- Modify: `src/lib/auth/permissions.ts` (insert after `canGrantBezirksDrohnenAdmin`, currently ending
  around line 116, right before the `canManageNews` doc-comment block).
- Modify: `src/lib/admin/nav-items.ts` (full file, 41 lines — replace entirely, see below).

**Interfaces:**
- Produces: `canAccessBezirksverwaltung(user: SessionUser): boolean`,
  `canManageFeuerwehrenBezirksweit(user: SessionUser): boolean`,
  `canManageDrohnengruppenBezirksweit(user: SessionUser): boolean` — all three consumed by Task 5
  (`bezirksverwaltung/page.tsx`) and Task 2 (`bezirksverwaltung/actions.ts`).
- Produces (schema): `Organization.isActive: boolean` (default `true`), `DroneGroup.isActive: boolean`
  (default `true`) — consumed by every later task.

- [ ] **Step 1: Add `isActive` to `Organization` in `prisma/schema.prisma`**

Find the `Organization` model's scalar fields (`id`, `name`, `shortName`, `nummer`, `type`, `icsToken`,
`createdAt`, `updatedAt`) and add one line right after `updatedAt`:

```prisma
model Organization {
  id        String           @id @default(cuid())
  name      String           @unique
  shortName String?
  nummer    String           @unique
  type      OrganizationType
  icsToken  String           @unique @default(cuid())
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  // Bezirksverwaltung: deaktivierte Feuerwehren/Abschnitte bleiben vollständig erhalten (Termine,
  // Mitgliedschaften, Historie) - isActive=false blendet sie nur aus NEUEN Zuordnungs-Auswahllisten
  // aus (siehe OrgSearchSelect/event-form.tsx), nie aus bestehenden Verwaltungsansichten. Additiv,
  // default(true) ist für jede bestehende Zeile korrekt - kein Backfill nötig.
  isActive  Boolean          @default(true)

  // ...restliche bestehende Felder unverändert...
```

**Step 2: Add `isActive` to `DroneGroup` in `prisma/schema.prisma`**

```prisma
model DroneGroup {
  id             String       @id @default(cuid())
  name           String       @unique
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  // Bezirksverwaltung - dieselbe Semantik wie Organization.isActive oben.
  isActive       Boolean      @default(true)

  // ...restliche bestehende Felder unverändert...
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:migrate` (prompts for a migration name — use `organization_dronegroup_is_active`).
Expected: a new folder under `prisma/migrations/` containing SQL that adds both columns with
`DEFAULT true`, and `npx prisma migrate dev` completes without error against the local dev database
(`docker compose -f docker-compose.dev.yml up -d` first if it isn't already running).

- [ ] **Step 4: Add the three permission functions to `src/lib/auth/permissions.ts`**

Insert immediately after `canGrantBezirksDrohnenAdmin`'s closing `}`:

```ts
/**
 * Sichtbarkeit der Seite /admin/bezirksverwaltung generell - Bezirksadmin ODER Bezirks-Drohnenadmin.
 * Reines Seiten-Gate: welche der drei Sektionen innerhalb der Seite tatsächlich rendert, entscheiden
 * canManageFeuerwehrenBezirksweit/canManageDrohnengruppenBezirksweit unten - ein reiner
 * Bezirks-Drohnenadmin erreicht die Seite über diese Funktion, sieht dort aber ausschließlich den
 * Drohnengruppen-Abschnitt.
 */
export function canAccessBezirksverwaltung(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/** Feuerwehren-Abschnitt (Anlegen/Umbenennen/Deaktivieren) + Bezirksadmin-Liste - exklusiv Bezirksadmin. */
export function canManageFeuerwehrenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}

/**
 * Drohnengruppen-Abschnitt (Anlegen/Umbenennen/Deaktivieren) - Bezirksadmin ODER Bezirks-Drohnenadmin.
 * Bewusst NICHT canManageDroneGroupFor wiederverwendet: jene Funktion prüft Rechte für eine
 * BESTEHENDE, bereits verankerte Gruppe (inkl. Abschnittsadmin/Gruppen-Admin) - das Anlegen einer
 * NEUEN Gruppe ist ein bezirksweiter Strukturakt, bewusst enger gefasst auf die beiden bezirksweiten
 * Rollen.
 */
export function canManageDrohnengruppenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}
```

- [ ] **Step 5: Replace the full content of `src/lib/admin/nav-items.ts`**

```ts
import type { SessionUser } from '@/types/next-auth';
import {
  canAccessBezirksverwaltung,
  canAccessHeimatfeuerwehrAdmin,
  canAccessUserManagementAdmin,
  isBezirksAdmin,
} from '@/lib/auth/permissions';

export interface AdminNavItem {
  href: string;
  label: string;
}

/** Shared by AdminSidebarNav (Server-Component-Aufrufer AdminSidebar) und AdminMobileTabs (von
 * jeder /admin/*-Seite selbst aufgerufen) - analog zu getNavItems in lib/nav-items.ts.
 * "Benutzerverwaltung" und "Heimatfeuerwehr" sind zusätzlich für reine Feuerwehr-Admins sichtbar
 * (siehe canAccessUserManagementAdmin/canAccessHeimatfeuerwehrAdmin, jeweils auf ihre eigene(n)
 * Feuerwehr(en) skaliert) - Drohnengruppe/E-Mail/Status/Bezirksverwaltung bleiben Site-Admin- bzw.
 * bezirksweiten Rollen vorbehalten, siehe CLAUDE.md "Sicherheits-Härtung". */
export function getAdminNavItems(user: SessionUser): AdminNavItem[] {
  const items: AdminNavItem[] = [];

  if (canAccessUserManagementAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Benutzerverwaltung' });
  }

  if (
    isBezirksAdmin(user) ||
    user.isBezirksDrohnenAdmin ||
    user.abschnittAdminOrgIds.length > 0 ||
    user.droneGroupRole === 'ADMIN'
  ) {
    items.push({ href: '/admin/drohnen', label: 'Drohnengruppe' });
  }

  if (canAccessHeimatfeuerwehrAdmin(user)) {
    items.push({ href: '/admin/heimatfeuerwehr', label: 'Heimatfeuerwehr' });
  }

  if (canAccessBezirksverwaltung(user)) {
    items.push({ href: '/admin/bezirksverwaltung', label: 'Bezirksverwaltung' });
  }

  if (isBezirksAdmin(user)) {
    items.push({ href: '/admin/email', label: 'E-Mail' }, { href: '/admin/status', label: 'Status' });
  }

  return items;
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (the three new permission functions and the nav entry are additive; nothing yet
calls them from a page, so no call-site type errors are possible at this point).

- [ ] **Step 7: Manual check — permission matrix**

Run this one-off script with `npx tsx`, then delete it:

```ts
import { canAccessBezirksverwaltung, canManageFeuerwehrenBezirksweit, canManageDrohnengruppenBezirksweit } from './src/lib/auth/permissions';

function user(overrides: Partial<{ isBezirksAdmin: boolean; isBezirksDrohnenAdmin: boolean }>) {
  return {
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    ...overrides,
  } as any;
}

const bezirksadmin = user({ isBezirksAdmin: true });
const bezirksDrohnenadmin = user({ isBezirksDrohnenAdmin: true });
const plain = user({});

console.log('Bezirksadmin - access/feuerwehren/drohnen:', canAccessBezirksverwaltung(bezirksadmin), canManageFeuerwehrenBezirksweit(bezirksadmin), canManageDrohnengruppenBezirksweit(bezirksadmin));
console.log('Bezirks-Drohnenadmin - access/feuerwehren/drohnen:', canAccessBezirksverwaltung(bezirksDrohnenadmin), canManageFeuerwehrenBezirksweit(bezirksDrohnenadmin), canManageDrohnengruppenBezirksweit(bezirksDrohnenadmin));
console.log('Plain user - access/feuerwehren/drohnen:', canAccessBezirksverwaltung(plain), canManageFeuerwehrenBezirksweit(plain), canManageDrohnengruppenBezirksweit(plain));
```

Expected output:
```
Bezirksadmin - access/feuerwehren/drohnen: true true true
Bezirks-Drohnenadmin - access/feuerwehren/drohnen: true false true
Plain user - access/feuerwehren/drohnen: false false false
```

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/auth/permissions.ts src/lib/admin/nav-items.ts
git commit -m "Bezirksverwaltung: isActive-Felder + Berechtigungen + Nav-Eintrag"
```

---

### Task 2: Validation schemas + Server Actions

**Files:**
- Create: `src/lib/validation/bezirksverwaltung.schema.ts`
- Create: `src/app/(app)/admin/bezirksverwaltung/actions.ts`

**Interfaces:**
- Consumes: `canManageFeuerwehrenBezirksweit`, `canManageDrohnengruppenBezirksweit`, `assertPermission`
  from `@/lib/auth/permissions` (Task 1); `Organization.isActive`/`DroneGroup.isActive` (Task 1).
- Produces: `createFeuerwehrSchema`, `renameFeuerwehrSchema`, `createDroneGroupSchema`,
  `renameDroneGroupSchema` (all `zod` schemas); `type BezirksverwaltungFormState = { error?: string;
  fieldErrors?: Record<string, string[] | undefined> }`; Server Actions `createFeuerwehr`,
  `renameFeuerwehr`, `toggleFeuerwehrActive`, `createDroneGroup`, `renameDroneGroup`,
  `toggleDroneGroupActive` — all consumed by Tasks 3 and 4's form components.

- [ ] **Step 1: Create `src/lib/validation/bezirksverwaltung.schema.ts`**

```ts
import { z } from 'zod';

export const createFeuerwehrSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
  shortName: z.string().trim().max(100).optional().or(z.literal('')),
  nummer: z.string().trim().min(1, 'Nummer ist erforderlich.').max(20),
  parentId: z.string().trim().min(1, 'Abschnitt ist erforderlich.'),
});
export type CreateFeuerwehrInput = z.infer<typeof createFeuerwehrSchema>;

export const renameFeuerwehrSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
  shortName: z.string().trim().max(100).optional().or(z.literal('')),
});
export type RenameFeuerwehrInput = z.infer<typeof renameFeuerwehrSchema>;

export const createDroneGroupSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
  organizationId: z.string().trim().min(1, 'Abschnitt ist erforderlich.'),
});
export type CreateDroneGroupInput = z.infer<typeof createDroneGroupSchema>;

export const renameDroneGroupSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
});
export type RenameDroneGroupInput = z.infer<typeof renameDroneGroupSchema>;
```

- [ ] **Step 2: Create `src/app/(app)/admin/bezirksverwaltung/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageDrohnengruppenBezirksweit, canManageFeuerwehrenBezirksweit } from '@/lib/auth/permissions';
import {
  createFeuerwehrSchema,
  renameFeuerwehrSchema,
  createDroneGroupSchema,
  renameDroneGroupSchema,
} from '@/lib/validation/bezirksverwaltung.schema';

export interface BezirksverwaltungFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function revalidate() {
  revalidatePath('/admin/bezirksverwaltung');
}

export async function createFeuerwehr(
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const parsed = createFeuerwehrSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    shortName: String(formData.get('shortName') ?? ''),
    nummer: String(formData.get('nummer') ?? ''),
    parentId: String(formData.get('parentId') ?? ''),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const parent = await prisma.organization.findUnique({ where: { id: data.parentId }, select: { type: true } });
  if (!parent || parent.type !== 'ABSCHNITTSKOMMANDO') {
    return { fieldErrors: { parentId: ['Ungültiger Abschnitt.'] } };
  }

  const [existingName, existingNummer] = await Promise.all([
    prisma.organization.findUnique({ where: { name: data.name } }),
    prisma.organization.findUnique({ where: { nummer: data.nummer } }),
  ]);
  if (existingName) {
    return { fieldErrors: { name: ['Eine Feuerwehr mit diesem Namen existiert bereits.'] } };
  }
  if (existingNummer) {
    return { fieldErrors: { nummer: ['Eine Feuerwehr mit dieser Nummer existiert bereits.'] } };
  }

  await prisma.organization.create({
    data: {
      name: data.name,
      shortName: data.shortName || null,
      nummer: data.nummer,
      parentId: data.parentId,
      type: 'FEUERWEHR',
    },
  });
  revalidate();
  return {};
}

export async function renameFeuerwehr(
  organizationId: string,
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const existing = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!existing) {
    return { error: 'Feuerwehr wurde nicht gefunden.' };
  }

  const parsed = renameFeuerwehrSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    shortName: String(formData.get('shortName') ?? ''),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.organization.findUnique({ where: { name: data.name } });
  if (existingName && existingName.id !== organizationId) {
    return { fieldErrors: { name: ['Eine Feuerwehr mit diesem Namen existiert bereits.'] } };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { name: data.name, shortName: data.shortName || null },
  });
  revalidate();
  return {};
}

export async function toggleFeuerwehrActive(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const existing = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  await prisma.organization.update({ where: { id: organizationId }, data: { isActive: !existing.isActive } });
  revalidate();
}

export async function createDroneGroup(
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const parsed = createDroneGroupSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    organizationId: String(formData.get('organizationId') ?? ''),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const anchor = await prisma.organization.findUnique({ where: { id: data.organizationId }, select: { type: true } });
  if (!anchor || anchor.type !== 'ABSCHNITTSKOMMANDO') {
    return { fieldErrors: { organizationId: ['Ungültiger Abschnitt.'] } };
  }

  const existingName = await prisma.droneGroup.findUnique({ where: { name: data.name } });
  if (existingName) {
    return { fieldErrors: { name: ['Eine Drohnengruppe mit diesem Namen existiert bereits.'] } };
  }

  await prisma.droneGroup.create({ data: { name: data.name, organizationId: data.organizationId } });
  revalidate();
  return {};
}

export async function renameDroneGroup(
  droneGroupId: string,
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const existing = await prisma.droneGroup.findUnique({ where: { id: droneGroupId } });
  if (!existing) {
    return { error: 'Drohnengruppe wurde nicht gefunden.' };
  }

  const parsed = renameDroneGroupSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.droneGroup.findUnique({ where: { name: data.name } });
  if (existingName && existingName.id !== droneGroupId) {
    return { fieldErrors: { name: ['Eine Drohnengruppe mit diesem Namen existiert bereits.'] } };
  }

  await prisma.droneGroup.update({ where: { id: droneGroupId }, data: { name: data.name } });
  revalidate();
  return {};
}

export async function toggleDroneGroupActive(droneGroupId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const existing = await prisma.droneGroup.findUniqueOrThrow({ where: { id: droneGroupId } });
  await prisma.droneGroup.update({ where: { id: droneGroupId }, data: { isActive: !existing.isActive } });
  revalidate();
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual check against the dev database**

Run this one-off script with `npx tsx` (uses a real seeded Abschnittskommando id — look one up first
via `npx prisma studio` or a quick `prisma.organization.findFirst({ where: { type: 'ABSCHNITTSKOMMANDO' } })`
call), then delete the script:

```ts
import { prisma } from './src/lib/db/prisma';
import { createFeuerwehr, renameFeuerwehr, toggleFeuerwehrActive } from './src/app/(app)/admin/bezirksverwaltung/actions';

// Bypasses requireUser() by calling prisma directly for setup/assertions - the actions themselves
// are exercised through their real exported functions, just without a real HTTP session. Replace
// this with any real user id that has isBezirksAdmin=true in your dev DB.
async function main() {
  const abschnitt = await prisma.organization.findFirstOrThrow({ where: { type: 'ABSCHNITTSKOMMANDO' } });
  const formData = new FormData();
  formData.set('name', 'FF Testfeuerwehr Bezirksverwaltung');
  formData.set('shortName', 'Testfeuerwehr');
  formData.set('nummer', '99999');
  formData.set('parentId', abschnitt.id);

  // NOTE: createFeuerwehr calls requireUser() internally, which needs a real session - this script
  // is meant to be adapted to your actual dev-session cookie/user, or the assertions below run
  // directly against Prisma to verify the DB STATE after exercising the action via the real app UI
  // once Task 3 lands. For a pure logic check before the UI exists, verify the schema/lookup logic
  // directly instead:
  const created = await prisma.organization.create({
    data: { name: 'FF Testfeuerwehr Bezirksverwaltung', shortName: 'Testfeuerwehr', nummer: '99999', parentId: abschnitt.id, type: 'FEUERWEHR' },
  });
  console.log('created, isActive default:', created.isActive); // expect true

  await prisma.organization.update({ where: { id: created.id }, data: { isActive: false } });
  const deactivated = await prisma.organization.findUniqueOrThrow({ where: { id: created.id } });
  console.log('after deactivate:', deactivated.isActive); // expect false

  await prisma.organization.update({ where: { id: created.id }, data: { isActive: true } });
  const reactivated = await prisma.organization.findUniqueOrThrow({ where: { id: created.id } });
  console.log('after reactivate:', reactivated.isActive); // expect true

  await prisma.organization.delete({ where: { id: created.id } }); // clean up the test row
  console.log('cleaned up');
}

main();
```

Expected output: `created, isActive default: true`, `after deactivate: false`,
`after reactivate: true`, `cleaned up`. This verifies the schema/default/toggle mechanics
independently of the UI, which Tasks 3-4 wire up next.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/bezirksverwaltung.schema.ts "src/app/(app)/admin/bezirksverwaltung/actions.ts"
git commit -m "Bezirksverwaltung: Validierung + Server Actions fuer Feuerwehren/Drohnengruppen"
```

---

### Task 3: Feuerwehren-Abschnitt UI

**Files:**
- Create: `src/app/(app)/admin/bezirksverwaltung/rename-feuerwehr-form.tsx`
- Create: `src/app/(app)/admin/bezirksverwaltung/add-feuerwehr-form.tsx`
- Create: `src/app/(app)/admin/bezirksverwaltung/feuerwehren-table.tsx`

**Interfaces:**
- Consumes: `renameFeuerwehr`, `createFeuerwehr`, `toggleFeuerwehrActive`, `BezirksverwaltungFormState`
  from `./actions` (Task 2).
- Produces: `FeuerwehrenTable` component with props `{ feuerwehren: FeuerwehrRow[]; abschnitte: {
  id: string; name: string }[] }` where `FeuerwehrRow = { id: string; name: string; shortName: string
  | null; nummer: string; abschnittName: string; isActive: boolean }` — consumed by Task 5's `page.tsx`.

- [ ] **Step 1: Create `src/app/(app)/admin/bezirksverwaltung/rename-feuerwehr-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { renameFeuerwehr, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function RenameFeuerwehrForm({
  organizationId,
  currentName,
  currentShortName,
}: {
  organizationId: string;
  currentName: string;
  currentShortName: string;
}) {
  const boundRename = renameFeuerwehr.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundRename, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        defaultValue={currentName}
        required
        placeholder="Name"
        className="w-48 rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <input
        name="shortName"
        defaultValue={currentShortName}
        placeholder="Kurzname"
        className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? '…' : 'Speichern'}
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
      {state.fieldErrors?.name && <span className="text-xs text-red-700">{state.fieldErrors.name[0]}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/admin/bezirksverwaltung/add-feuerwehr-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { createFeuerwehr, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function AddFeuerwehrForm({ abschnitte }: { abschnitte: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createFeuerwehr, initialState);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-name" className="text-sm font-medium text-neutral-700">
          Name
        </label>
        <input id="feuerwehr-name" name="name" required placeholder="FF Neu" className="rounded border border-neutral-300 px-3 py-2" />
        {state.fieldErrors?.name && <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-shortName" className="text-sm font-medium text-neutral-700">
          Kurzname
        </label>
        <input id="feuerwehr-shortName" name="shortName" placeholder="Neu" className="rounded border border-neutral-300 px-3 py-2" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-nummer" className="text-sm font-medium text-neutral-700">
          Nummer
        </label>
        <input id="feuerwehr-nummer" name="nummer" required placeholder="17712" className="rounded border border-neutral-300 px-3 py-2" />
        {state.fieldErrors?.nummer && <p className="text-xs text-red-700">{state.fieldErrors.nummer[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-parentId" className="text-sm font-medium text-neutral-700">
          Abschnitt
        </label>
        <select id="feuerwehr-parentId" name="parentId" required className="rounded border border-neutral-300 px-3 py-2">
          {abschnitte.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.parentId && <p className="text-xs text-red-700">{state.fieldErrors.parentId[0]}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : 'Anlegen'}
      </button>
      {state.error && <p className="col-span-full text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/admin/bezirksverwaltung/feuerwehren-table.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RenameFeuerwehrForm } from './rename-feuerwehr-form';
import { AddFeuerwehrForm } from './add-feuerwehr-form';
import { toggleFeuerwehrActive } from './actions';

export interface FeuerwehrRow {
  id: string;
  name: string;
  shortName: string | null;
  nummer: string;
  abschnittName: string;
  isActive: boolean;
}

/** Freitext-Suchfeld analog zur Benutzertabelle (bei 124 Feuerwehren rechtfertigt sich das) - rein
 * clientseitig über den bereits serverseitig geladenen, vollständigen FeuerwehrRow[]-Array, kein
 * Server-Roundtrip pro Tastenanschlag, gleiches Muster wie UserManagementSection. */
export function FeuerwehrenTable({ feuerwehren, abschnitte }: { feuerwehren: FeuerwehrRow[]; abschnitte: { id: string; name: string }[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return feuerwehren;
    return feuerwehren.filter(
      (f) => f.name.toLowerCase().includes(q) || (f.shortName ?? '').toLowerCase().includes(q) || f.nummer.includes(q),
    );
  }, [feuerwehren, search]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Feuerwehr suchen …"
        className="w-full max-w-sm rounded-md border border-line px-3 py-2 text-sm"
      />
      <Table>
        <TableHeader>
          <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name / Kurzname</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Nummer</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Abschnitt</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((f) => {
            const boundToggle = toggleFeuerwehrActive.bind(null, f.id);
            return (
              <TableRow key={f.id} className="border-line">
                <TableCell>
                  <RenameFeuerwehrForm organizationId={f.id} currentName={f.name} currentShortName={f.shortName ?? ''} />
                </TableCell>
                <TableCell className="font-mono text-ink-muted">{f.nummer}</TableCell>
                <TableCell className="text-ink-muted">{f.abschnittName}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={f.isActive ? 'border-transparent bg-success-subtle text-success-text' : 'border-transparent bg-danger-subtle text-danger'}
                  >
                    {f.isActive ? 'Aktiv' : 'Deaktiviert'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <form action={boundToggle}>
                    <button type="submit" className="text-sm text-brand hover:underline">
                      {f.isActive ? 'Deaktivieren' : 'Reaktivieren'}
                    </button>
                  </form>
                </TableCell>
              </TableRow>
            );
          })}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-ink-muted">
                Keine Feuerwehr entspricht der Suche.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <AddFeuerwehrForm abschnitte={abschnitte} />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (this task's three files are self-contained and not yet imported anywhere, so no
call-site errors are possible yet — Task 5 wires them in).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/bezirksverwaltung/rename-feuerwehr-form.tsx" "src/app/(app)/admin/bezirksverwaltung/add-feuerwehr-form.tsx" "src/app/(app)/admin/bezirksverwaltung/feuerwehren-table.tsx"
git commit -m "Bezirksverwaltung: Feuerwehren-Tabelle mit Anlegen/Umbenennen/Deaktivieren"
```

---

### Task 4: Drohnengruppen-Abschnitt UI

**Files:**
- Create: `src/app/(app)/admin/bezirksverwaltung/rename-drone-group-form.tsx`
- Create: `src/app/(app)/admin/bezirksverwaltung/add-drone-group-form.tsx`

**Interfaces:**
- Consumes: `renameDroneGroup`, `createDroneGroup`, `toggleDroneGroupActive`,
  `BezirksverwaltungFormState` from `./actions` (Task 2).
- Produces: `DroneGroupRow = { id: string; name: string; abschnittName: string; isActive: boolean }`
  (as a plain inline type used directly by Task 5's `page.tsx`, no separate table component needed —
  4-ish rows don't justify search/a dedicated component the way 124 Feuerwehren do, matching the
  design's own "keine Gruppierung nötig bei dieser geringen Anzahl").

- [ ] **Step 1: Create `src/app/(app)/admin/bezirksverwaltung/rename-drone-group-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { renameDroneGroup, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function RenameDroneGroupForm({ droneGroupId, currentName }: { droneGroupId: string; currentName: string }) {
  const boundRename = renameDroneGroup.bind(null, droneGroupId);
  const [state, formAction, pending] = useActionState(boundRename, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input name="name" defaultValue={currentName} required className="rounded border border-neutral-300 px-2 py-1 text-sm" />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? '…' : 'Speichern'}
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
      {state.fieldErrors?.name && <span className="text-xs text-red-700">{state.fieldErrors.name[0]}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/admin/bezirksverwaltung/add-drone-group-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { createDroneGroup, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function AddDroneGroupForm({ abschnitte }: { abschnitte: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createDroneGroup, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="dronegroup-name" className="text-sm font-medium text-neutral-700">
          Name
        </label>
        <input id="dronegroup-name" name="name" required placeholder="Drohnengruppe Neu" className="rounded border border-neutral-300 px-3 py-2" />
        {state.fieldErrors?.name && <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="dronegroup-organizationId" className="text-sm font-medium text-neutral-700">
          Anker-Abschnitt
        </label>
        <select id="dronegroup-organizationId" name="organizationId" required className="rounded border border-neutral-300 px-3 py-2">
          {abschnitte.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.organizationId && <p className="text-xs text-red-700">{state.fieldErrors.organizationId[0]}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : 'Anlegen'}
      </button>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/bezirksverwaltung/rename-drone-group-form.tsx" "src/app/(app)/admin/bezirksverwaltung/add-drone-group-form.tsx"
git commit -m "Bezirksverwaltung: Drohnengruppen-Formulare fuer Anlegen/Umbenennen"
```

---

### Task 5: Bezirksadmin-Liste + page.tsx (assembling all three sections)

**Files:**
- Create: `src/app/(app)/admin/bezirksverwaltung/page.tsx`

**Interfaces:**
- Consumes: `canAccessBezirksverwaltung`, `canManageFeuerwehrenBezirksweit`,
  `canManageDrohnengruppenBezirksweit` (Task 1); `FeuerwehrenTable`, `FeuerwehrRow` (Task 3);
  `RenameDroneGroupForm`, `AddDroneGroupForm` (Task 4); `toggleDroneGroupActive` (Task 2);
  `getAdminNavItems`, `getReachableScopes`, `GeltungsbereichSelector`, `AdminMobileTabs` (all
  pre-existing, same pattern as every other `/admin/*` page).
- Produces: the reachable page itself at `/admin/bezirksverwaltung` — no other task consumes this one.

- [ ] **Step 1: Create `src/app/(app)/admin/bezirksverwaltung/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessBezirksverwaltung, canManageDrohnengruppenBezirksweit, canManageFeuerwehrenBezirksweit } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FeuerwehrenTable, type FeuerwehrRow } from './feuerwehren-table';
import { RenameDroneGroupForm } from './rename-drone-group-form';
import { AddDroneGroupForm } from './add-drone-group-form';
import { toggleDroneGroupActive } from './actions';

export default async function BezirksverwaltungPage() {
  const user = await requireUser();
  if (!canAccessBezirksverwaltung(user)) {
    notFound();
  }
  const reachableScopes = await getReachableScopes(user);
  const showFeuerwehren = canManageFeuerwehrenBezirksweit(user);
  const showDrohnengruppen = canManageDrohnengruppenBezirksweit(user);

  const abschnitte = await prisma.organization.findMany({
    where: { type: 'ABSCHNITTSKOMMANDO' },
    select: { id: true, name: true, shortName: true },
    orderBy: { name: 'asc' },
  });
  const abschnittOptions = abschnitte.map((a) => ({ id: a.id, name: a.shortName ?? a.name }));
  const abschnittNameById = new Map(abschnittOptions.map((a) => [a.id, a.name]));

  const [feuerwehren, droneGroups, bezirksadmins] = await Promise.all([
    showFeuerwehren
      ? prisma.organization.findMany({
          where: { type: 'FEUERWEHR' },
          select: { id: true, name: true, shortName: true, nummer: true, parentId: true, isActive: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    showDrohnengruppen
      ? prisma.droneGroup.findMany({
          select: { id: true, name: true, organizationId: true, isActive: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    showFeuerwehren
      ? prisma.user.findMany({
          where: { isBezirksAdmin: true },
          select: { id: true, firstName: true, lastName: true, email: true, homeOrganization: { select: { name: true, shortName: true } } },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const feuerwehrRows: FeuerwehrRow[] = feuerwehren.map((f) => ({
    id: f.id,
    name: f.name,
    shortName: f.shortName,
    nummer: f.nummer,
    abschnittName: abschnittNameById.get(f.parentId ?? '') ?? '–',
    isActive: f.isActive,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold text-ink">Bezirksverwaltung</h1>
      </div>

      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />

      {showFeuerwehren && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Feuerwehren</h2>
          <FeuerwehrenTable feuerwehren={feuerwehrRows} abschnitte={abschnittOptions} />
        </div>
      )}

      {showDrohnengruppen && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Drohnengruppen</h2>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Anker-Abschnitt</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {droneGroups.map((group) => {
                const boundToggle = toggleDroneGroupActive.bind(null, group.id);
                return (
                  <TableRow key={group.id} className="border-line">
                    <TableCell>
                      <RenameDroneGroupForm droneGroupId={group.id} currentName={group.name} />
                    </TableCell>
                    <TableCell className="text-ink-muted">{abschnittNameById.get(group.organizationId) ?? '–'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={group.isActive ? 'border-transparent bg-success-subtle text-success-text' : 'border-transparent bg-danger-subtle text-danger'}
                      >
                        {group.isActive ? 'Aktiv' : 'Deaktiviert'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={boundToggle}>
                        <button type="submit" className="text-sm text-brand hover:underline">
                          {group.isActive ? 'Deaktivieren' : 'Reaktivieren'}
                        </button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
              {droneGroups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-ink-muted">
                    Noch keine Drohnengruppe angelegt.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-3">
            <AddDroneGroupForm abschnitte={abschnittOptions} />
          </div>
        </div>
      )}

      {showFeuerwehren && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Bezirksadmins</h2>
          <p className="mb-3 text-xs text-ink-faint">Nur sichtbar - Verwaltung erfolgt über die Benutzerverwaltung.</p>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">E-Mail</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Heimatfeuerwehr</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bezirksadmins.map((admin) => (
                <TableRow key={admin.id} className="border-line">
                  <TableCell className="text-ink">
                    {admin.lastName} {admin.firstName}
                  </TableCell>
                  <TableCell className="text-ink-muted">{admin.email}</TableCell>
                  <TableCell className="text-ink-muted">{admin.homeOrganization.shortName ?? admin.homeOrganization.name}</TableCell>
                </TableRow>
              ))}
              {bezirksadmins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-ink-muted">
                    Keine Bezirksadmins gefunden.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Then run `npm run build` — expected: succeeds, and the route table includes
`/admin/bezirksverwaltung`.

- [ ] **Step 3: Manual check via dev server**

If the dev server can be started correctly bound to this worktree (verify via the listening process's
command line pointing at this worktree's `node_modules`, not a different one — this repo has a known,
previously-confirmed multi-worktree binding issue), log in as the seeded Bezirksadmin account and open
`/admin/bezirksverwaltung`: confirm all three sections render, the Feuerwehren search box filters the
table, "Anlegen" creates a new Feuerwehr requiring a unique name/nummer, "Deaktivieren"/"Reaktivieren"
flips the badge, and the same for Drohnengruppen. Then log in as a Bezirks-Drohnenadmin-only test
account and confirm ONLY the Drohnengruppen section renders (no Feuerwehren section, no Bezirksadmin
list). If the dev server binds to the wrong worktree, fall back to a careful static trace of the
`showFeuerwehren`/`showDrohnengruppen` conditions against both permission profiles instead.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/bezirksverwaltung/page.tsx"
git commit -m "Bezirksverwaltung: Seite mit allen drei Abschnitten zusammensetzen"
```

---

### Task 6: `isActive`-Filterung in bestehenden Auswahllisten

**Files:**
- Modify: `src/components/admin/org-search-select.tsx` (full file, 113 lines — replace entirely).
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx:76-81` (the `Organization` interface only).
- Modify: `src/app/(app)/admin/benutzer/page.tsx:128-133` (the `organizations` mapping only).
- Modify: `src/components/admin/user-form-sheet.tsx:33-37` (the `OrganizationOption` interface only).
- Modify: `src/lib/calendar/drone-group-options.ts` (full file — replace entirely).
- Modify: `src/components/calendar/event-form.tsx:11-15` (the `OrganizationOption` interface) and the
  Organisation `<option>` rendering (currently `{org.name}`).
- Modify: `src/app/(app)/kalender/neu/page.tsx` (the `organizations` query's `where`).
- Modify: `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx` (the `organizations` query's `where`,
  and the `getManageableDroneGroupOptions` call).
- Modify: `src/app/(app)/news/neu/page.tsx` (both queries' `where`).

**Interfaces:**
- Consumes: `Organization.isActive`/`DroneGroup.isActive` (Task 1).
- Modifies: `OrgSearchSelectOption` gains `isActive?: boolean`; `getManageableDroneGroupOptions(user:
  SessionUser, currentDroneGroupId?: string | null): Promise<DroneGroupFormOption[]>` — signature gains
  a second, optional parameter (existing callers that omit it are unaffected).

- [ ] **Step 1: Replace the full content of `src/components/admin/org-search-select.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';
import { groupByAbschnitt } from '@/lib/admin/group-by-abschnitt';

export interface OrgSearchSelectOption {
  id: string;
  name: string;
  abschnittName?: string;
  /** Bezirksverwaltung: deaktivierte Organisationen werden aus der Liste NEUER Auswahlmöglichkeiten
   * entfernt (siehe selectableOptions unten), bleiben aber wählbar/sichtbar, wenn sie der aktuell
   * gesetzte `value` sind - sonst würde ein Formular, das eine inzwischen deaktivierte Feuerwehr
   * bereits zugeordnet hat, beim Öffnen keine passende Auswahl mehr anzeigen können. Fehlt dieses
   * Feld (bestehende Aufrufer, die das Konzept nicht kennen), gilt es als aktiv (`!== false`).
   */
  isActive?: boolean;
}

/**
 * Einzelauswahl-Geschwister von AdminOrgMultiSelect - gleiche Popover+Command-Bauweise, gleiches
 * "nach Abschnitt gruppiert"-Verhalten, aber ein einzelner gewählter Wert statt eines Arrays.
 * Geschlossen zeigt der Trigger entweder den gewählten Namen oder `allLabel` (z. B. "Alle
 * Feuerwehren") - anders als AdminOrgMultiSelects "N von M ausgewählt", da hier höchstens ein
 * Eintrag gewählt sein kann.
 *
 * `allLabel` ist bewusst optional: die beiden Filter-Aufrufer (Abschnitt-/Feuerwehr-Filter in
 * user-management-section.tsx) brauchen einen "Alle ..."-Eintrag, weil "keine Auswahl" dort "kein
 * Filter" bedeutet. Ein Pflichtfeld wie "Heimat-Feuerwehr" im UserFormSheet hat dagegen kein
 * "Alle"-Konzept - dort ist immer genau eine echte Organisation ausgewählt - deshalb wird der
 * "Alle"-Eintrag nur gerendert, wenn `allLabel` übergeben wird.
 */
export function OrgSearchSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  allValue = 'ALLE',
  id,
  triggerClassName = '',
}: {
  options: OrgSearchSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  allLabel?: string;
  allValue?: string;
  id?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => options.find((org) => org.id === value), [options, value]);
  // Deaktivierte Organisationen bleiben nur wählbar, wenn sie der aktuell gesetzte Wert sind - siehe
  // OrgSearchSelectOption.isActive's Kommentar oben.
  const selectableOptions = useMemo(
    () => options.filter((org) => org.isActive !== false || org.id === value),
    [options, value],
  );
  const hasAbschnittGroups = selectableOptions.some((org) => Boolean(org.abschnittName));
  const filteredOptions = useMemo(
    () => selectableOptions.filter((org) => org.name.toLowerCase().includes(search.trim().toLowerCase())),
    [selectableOptions, search],
  );

  function select(id: string) {
    onChange(id);
    setSearch('');
    setOpen(false);
  }

  function displayName(org: OrgSearchSelectOption): string {
    return org.isActive === false ? `${org.name} (deaktiviert)` : org.name;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={`flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-sm transition-colors ${
            open ? 'border-2 border-brand px-[11px]' : 'border-line'
          } ${triggerClassName}`}
        >
          <span className={selected ? 'text-ink' : 'text-ink-faint'}>
            {selected ? displayName(selected) : allLabel ?? placeholder}
          </span>
          <span className="flex-none text-ink-faint">{open ? '▴' : '▾'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[220px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`${placeholder} suchen …`} value={search} onValueChange={setSearch} />
          <CommandList>
            {filteredOptions.length === 0 && (
              <div className="py-4 text-center text-sm text-ink-faint">Keine Treffer.</div>
            )}
            {allLabel && (
              <CommandGroup>
                <CommandItem
                  value={allValue}
                  onSelect={() => select(allValue)}
                  className={value === allValue ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                >
                  {allLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {Object.entries(groupByAbschnitt(filteredOptions)).map(([abschnittName, orgs]) => (
              <CommandGroup key={abschnittName} heading={hasAbschnittGroups ? abschnittName : undefined}>
                {orgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={org.id}
                    onSelect={() => select(org.id)}
                    className={value === org.id ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                  >
                    {displayName(org)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Add `isActive?: boolean` to the local `Organization` interface in `user-management-section.tsx`**

Find (around line 76):
```ts
interface Organization {
  id: string;
  name: string;
  abschnittName?: string;
  abschnittId?: string;
}
```
Replace with:
```ts
interface Organization {
  id: string;
  name: string;
  abschnittName?: string;
  abschnittId?: string;
  isActive?: boolean;
}
```

- [ ] **Step 3: Pass `isActive` through in `admin/benutzer/page.tsx`'s `organizations` mapping**

Find (around line 128):
```tsx
      organizations={organizations.map((org) => ({
        id: org.id,
        name: org.shortName ?? org.name,
        abschnittName: org.parent?.shortName ?? org.parent?.name,
        abschnittId: org.parent?.id,
      }))}
```
Replace with:
```tsx
      organizations={organizations.map((org) => ({
        id: org.id,
        name: org.shortName ?? org.name,
        abschnittName: org.parent?.shortName ?? org.parent?.name,
        abschnittId: org.parent?.id,
        isActive: org.isActive,
      }))}
```

(No change to the `organizations` Prisma query itself — it already selects every scalar column,
including the new `isActive`, since it has no `select:` clause.)

- [ ] **Step 4: Add `isActive?: boolean` to `OrganizationOption` in `user-form-sheet.tsx`**

Find (around line 33):
```ts
interface OrganizationOption {
  id: string;
  name: string;
  abschnittName?: string;
}
```
Replace with:
```ts
interface OrganizationOption {
  id: string;
  name: string;
  abschnittName?: string;
  isActive?: boolean;
}
```

(This is the ONLY change needed in `user-form-sheet.tsx` — it already forwards `options={organizations}`
straight into `OrgSearchSelect` unchanged; `AdminOrgMultiSelect`/"Admin für" is a separate component
this task does not touch, per the design's own scope.)

- [ ] **Step 5: Replace the full content of `src/lib/calendar/drone-group-options.ts`**

```ts
import { prisma } from '@/lib/db/prisma';
import { canManageBezirksWideDroneEvent, canManageDroneGroupFor } from '@/lib/auth/permissions';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
import type { SessionUser } from '@/types/next-auth';

export interface DroneGroupFormOption {
  id: string;
  name: string;
}

/**
 * Drohnengruppen, für die dieser Nutzer im Kalender-Formular einen Termin anlegen/bearbeiten darf.
 * Lädt nur aktive Gruppen (Bezirksverwaltung: isActive=false blendet eine Gruppe aus NEUEN
 * Zuordnungen aus) - AUSSER `currentDroneGroupId` ist gesetzt (Bearbeiten eines bestehenden
 * Drohnengruppen-Termins): dann bleibt genau diese eine Gruppe wählbar, auch wenn sie inzwischen
 * deaktiviert wurde, sonst könnte das Bearbeitungsformular den aktuellen Wert nicht mehr anzeigen.
 * Filtert einzeln über canManageDroneGroupFor (bewusst nicht nur die eigene Mitgliedschaft - siehe
 * canManageEvent in permissions.ts und Design-Spec Abschnitt 4.2 des Kalender/Drohnengruppen-Plans).
 * Ergänzt am Ende den bezirksweiten Sentinel-Eintrag, wenn der Nutzer den bezirksweiten
 * Drohnengruppen-Termin anlegen darf (Bezirksadmin/Bezirks-Drohnenadmin).
 */
export async function getManageableDroneGroupOptions(
  user: SessionUser,
  currentDroneGroupId?: string | null,
): Promise<DroneGroupFormOption[]> {
  const groups = await prisma.droneGroup.findMany({
    where: currentDroneGroupId ? { OR: [{ isActive: true }, { id: currentDroneGroupId }] } : { isActive: true },
    select: { id: true, name: true, organizationId: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const options: DroneGroupFormOption[] = groups
    .filter((group) => canManageDroneGroupFor(user, group))
    .map((group) => ({ id: group.id, name: group.isActive ? group.name : `${group.name} (deaktiviert)` }));
  if (canManageBezirksWideDroneEvent(user)) {
    options.push({ id: BEZIRKSWEIT_DRONE_GROUP_VALUE, name: 'Alle Drohnengruppen (bezirksweit)' });
  }
  return options;
}
```

- [ ] **Step 6: Add `isActive?: boolean` to `OrganizationOption` in `event-form.tsx` and update the Organisation `<option>` rendering**

Find (around line 11):
```tsx
interface OrganizationOption {
  id: string;
  name: string;
  type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
}
```
Replace with:
```tsx
interface OrganizationOption {
  id: string;
  name: string;
  type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  isActive?: boolean;
}
```

Find the Organisation `<select>`'s `<option>` mapping:
```tsx
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
```
Replace with:
```tsx
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.isActive === false ? `${org.name} (deaktiviert)` : org.name}
            </option>
          ))}
```

- [ ] **Step 7: Filter `kalender/neu/page.tsx`'s Organisation query**

Find:
```tsx
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds } },
      orderBy: { name: 'asc' },
    }),
```
Replace with:
```tsx
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds }, isActive: true },
      orderBy: { name: 'asc' },
    }),
```

(This file's `getManageableDroneGroupOptions(user)` call needs NO change — it's a pure create flow,
no current value to preserve, and the function's new second parameter is optional.)

- [ ] **Step 8: Filter `kalender/[eventId]/bearbeiten/page.tsx`'s Organisation query, with a carve-out for the event's current organization**

Find:
```tsx
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds } },
      orderBy: { name: 'asc' },
    }),
```
Replace with:
```tsx
    prisma.organization.findMany({
      where: { OR: [{ id: { in: user.feuerwehrAdminOrgIds }, isActive: true }, { id: event.organizationId }] },
      orderBy: { name: 'asc' },
    }),
```

- [ ] **Step 9: Pass the event's current drone group id into `getManageableDroneGroupOptions` in the same file**

Find:
```tsx
    getManageableDroneGroupOptions(user),
```
Replace with:
```tsx
    getManageableDroneGroupOptions(user, event.category === 'DROHNENGRUPPE' ? event.droneGroupId : undefined),
```

- [ ] **Step 10: Filter both audience queries in `news/neu/page.tsx`**

Find:
```tsx
  const [organizations, droneGroups] = await Promise.all([
    prisma.organization.findMany({ orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ orderBy: { name: 'asc' } }),
  ]);
```
Replace with:
```tsx
  const [organizations, droneGroups] = await Promise.all([
    prisma.organization.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);
```

(This is a pure create flow — no existing News message can be edited, so no current-value carve-out
is needed here, unlike the two Kalender queries above.)

- [ ] **Step 11: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 12: Manual check**

If the dev server can be started correctly bound to this worktree, deactivate a Feuerwehr via the new
Bezirksverwaltung page, then: (a) open `UserFormSheet` for a NEW user — confirm the deactivated
Feuerwehr no longer appears in the Heimat-Feuerwehr picker; (b) open the EDIT sheet for an EXISTING
user whose `homeOrganizationId` is that now-deactivated Feuerwehr — confirm the picker still shows and
correctly displays that Feuerwehr (with the "(deaktiviert)" suffix) as the current value, and saving
the form WITHOUT changing that field still succeeds. Repeat the same two checks for a deactivated
Drohnengruppe against `/kalender/neu` and `/kalender/[eventId]/bearbeiten` (an existing Drohnengruppe-
category event anchored to that group). If the dev server binds to the wrong worktree, fall back to a
careful static trace of `selectableOptions`'s filter predicate and the two Prisma `OR` where-clauses
against both scenarios (new pick vs. already-assigned-and-now-inactive) instead.

- [ ] **Step 13: Commit**

```bash
git add src/components/admin/org-search-select.tsx "src/app/(app)/admin/benutzer/user-management-section.tsx" "src/app/(app)/admin/benutzer/page.tsx" src/components/admin/user-form-sheet.tsx src/lib/calendar/drone-group-options.ts src/components/calendar/event-form.tsx "src/app/(app)/kalender/neu/page.tsx" "src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx" "src/app/(app)/news/neu/page.tsx"
git commit -m "Bezirksverwaltung: deaktivierte Feuerwehren/Drohnengruppen aus Neuzuordnungs-Auswahllisten ausblenden"
```

## Self-Review

**Spec coverage:**
- §2 (Datenmodell, kein Hard-Delete): Task 1 (schema), no delete action exists anywhere in Task 2.
- §3 (Deaktivieren-Effekt, kein Kaskadieren): Task 2's `toggleFeuerwehrActive`/`toggleDroneGroupActive`
  touch only the single row; Task 6 confirms no `User`/`Membership` write anywhere.
- §4 (Berechtigungen): Task 1.
- §5 (Feuerwehren UI): Task 3 + Task 5's assembly.
- §6 (Drohnengruppen UI): Task 4 + Task 5's assembly.
- §7 (Bezirksadmin-Liste): Task 5.
- §8 (Auswahllisten-Auswirkungen): Task 6, with the full enumeration done during planning (see the
  File Structure section's "Explicitly NOT modified" list for the exceptions this plan deliberately
  leaves alone, and why).
- §9 (Nicht-Ziele): `nummer` has no update path anywhere in Task 2/3 (`renameFeuerwehrSchema` excludes
  it); `type` is hard-coded `FEUERWEHR` in `createFeuerwehr`; no delete action exists.
- §10 (Abnahme): every bullet maps to a Task 3/4/5/6 manual-check step above.

**Placeholder scan:** no TBD/TODO; every step has complete, real code.

**Type consistency:** `BezirksverwaltungFormState` (Task 2) is the one shared type used identically by
all 4 rename/create forms across Tasks 3-4. `FeuerwehrRow` (Task 3) and its field names
(`abschnittName`, `isActive`) match exactly what Task 5's `page.tsx` constructs. `getManageableDroneGroupOptions`'s
new second parameter is used identically in Task 6 Step 9 to how Task 5/2's other call sites expect
(optional, backward-compatible). `OrgSearchSelectOption.isActive` (Task 6) is consumed the same way
across every existing `OrgSearchSelect` caller (both pre-existing filter call sites simply never pass
it, which is fine since it's optional and defaults to "active").

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-12-bezirksverwaltung-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
