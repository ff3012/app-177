# Kalender: Sondergruppen & Bezirk-weite Termine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-extensible `Sondergruppe` tag (Feuerwehrjugend/Schadstoffgruppe/Kommanden/...) that can
be attached to `ALLGEMEIN` calendar events, a third "Bezirk-weit" Geltungsbereich for `ALLGEMEIN` events
(alongside the existing eigene-Feuerwehr/Abschnitt-weit), and a personal, server-persisted per-member filter
that hides events tagged with chosen Sondergruppen from that member's own calendar.

**Architecture:** Two small, additive Prisma changes (`Sondergruppe` model; `Event.sondergruppeId`/
`Event.isDistrictWide`; `User.ausgeblendeteSondergruppenIds`) ride on top of the existing category-first
`canViewEvent`/`canManageEvent` permission architecture without touching the Drohnengruppe branch at all.
Visibility for `isDistrictWide` is a pure additional OR-condition, duplicated at the same handful of call
sites the root `CLAUDE.md` already documents for `isSectionWide`. The personal Sondergruppen filter is a
client-side-only display filter (never a security boundary) mirroring the existing Ebenen-Toggle pattern,
persisted via a small direct-callable Server Action mirroring `setRsvp`.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma/PostgreSQL, `react-hook-form`
+ `zod`, plain hand-rolled Tailwind UI (this module does not use shadcn).

**Design spec:** `docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md` — read it first for the
full rationale; this plan implements it task-by-task.

## Global Constraints

- No automated test suite in this repo. Every task's verification is `npx tsc --noEmit`, `npm run build`,
  and a manual check against the local dev Postgres database (via a throwaway script or `npx prisma studio`/
  `psql`), exactly as the design spec's own Testing section states.
- `sondergruppeId` NEVER affects `canViewEvent`/`canManageEvent` — it is a pure display tag. Do not add any
  authorization check keyed on it anywhere in this plan.
- `isDistrictWide` is `ALLGEMEIN`-category-only. The `DROHNENGRUPPE` branches of `createEvent`/`updateEvent`
  (`kalender/actions.ts`) must always persist `isDistrictWide: false, sondergruppeId: null` explicitly,
  never leave them unset, so a category switch on an existing event can never leave stale values behind.
- The Drohnengruppe module (`EventCategory.DROHNENGRUPPE`, `canViewDroneModule`, `DroneGroup`, ...) is
  explicitly out of scope and must not be touched anywhere in this plan — confirmed by the user during
  brainstorming.
- Every ALLGEMEIN visibility query duplicated across the codebase (`kalender/page.tsx`, `meine-feuerwehr/
  page.tsx`, `kalender/ics/[token]/route.ts`'s two queries, `lib/push/audience.ts`) must gain the identical
  `isDistrictWide` OR-condition — this list is authoritative, copied from the root `CLAUDE.md`'s own
  "Bezirk / Abschnitt / Feuerwehr hierarchy" section.
- `KalenderWithLayers` (`src/components/calendar/kalender-with-layers.tsx`) must stay framework-agnostic (no
  `next/navigation` import, still reused read-only by `/offline-kalender`) — any Server-Action-calling logic
  for the new personal filter belongs in `KalenderWithLayersOnline` or above, passed down as a plain callback
  prop, exactly like the existing `onNavigate` prop.
- Follow existing naming/copy conventions exactly: German UI copy, `assertPermission(condition, message?)`
  from `@/lib/auth/permissions` for hard-fail checks, `{ error }`/`{ fieldErrors }` `BezirksverwaltungFormState`
  shape for Bezirksverwaltung forms, the existing `revalidatePath('/kalender')` pattern for Kalender writes.

---

## Task 1: Schema — `Sondergruppe` model, `Event`/`User` fields, migration, seed

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`

**Interfaces:**
- Produces: Prisma model `Sondergruppe { id, name, sortOrder, isActive, events }`; `Event.sondergruppeId:
  String?`, `Event.sondergruppe: Sondergruppe?`, `Event.isDistrictWide: Boolean @default(false)`;
  `User.ausgeblendeteSondergruppenIds: String[] @default([])`. Later tasks read/write all of these by exactly
  these names.

- [ ] **Step 1: Add the `Sondergruppe` model to `prisma/schema.prisma`**

Insert this new model directly after the existing `Dienstgrad` model block (which currently ends at line 340
with `@@index([kategorie])` followed by a blank line and `// Login-Rate-Limiting: ...` / `model
LoginAttempt`). Insert the new model between them:

```prisma
// Erweiterbare, über die Bezirksverwaltung gepflegte Liste von Sonderinteressen-Gruppen
// (Feuerwehrjugend/Schadstoffgruppe/Kommanden/...) für die Kalender-Kategorisierung - siehe
// docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md. Rein informativ: keine eigene
// Mitgliedschaft/kein eigenes Sichtbarkeits-Gate wie bei DroneGroup, nur ein optionales Tag an
// ALLGEMEIN-Terminen plus eine persönliche Anzeige-Filtereinstellung pro Mitglied (siehe
// User.ausgeblendeteSondergruppenIds). sortOrder ist @unique wie bei Dienstgrad, für eine feste
// Anzeige-Reihenfolge statt alphabetisch.
model Sondergruppe {
  id        String  @id @default(cuid())
  name      String  @unique
  sortOrder Int     @unique
  isActive  Boolean @default(true)

  events Event[]
}
```

- [ ] **Step 2: Add `ausgeblendeteSondergruppenIds` to the `User` model**

In `prisma/schema.prisma`'s `model User { ... }` block, find these two existing lines (currently right before
the `homeOrganization Organization @relation(...)` line):

```prisma
  isBezirksDrohnenAdmin Boolean @default(false)

  homeOrganization       Organization             @relation("HomeOrganization", fields: [homeOrganizationId], references: [id])
```

Insert the new field between them:

```prisma
  isBezirksDrohnenAdmin Boolean @default(false)

  // Persönliche, gespeicherte Kalender-Filtereinstellung (siehe docs/superpowers/specs/
  // 2026-09-01-kalender-sondergruppen-design.md) - welche Sondergruppen dieses Mitglied im eigenen
  // Kalender ausblendet. Leeres Array ist ein bewusster Opt-in-Sentinel ("noch keine Auswahl
  // getroffen" = alle Sondergruppen ausgeblendet), keine Bedeutung als "nichts ausgeblendet" - siehe
  // die Standardlogik in kalender/page.tsx.
  ausgeblendeteSondergruppenIds String[] @default([])

  homeOrganization       Organization             @relation("HomeOrganization", fields: [homeOrganizationId], references: [id])
```

- [ ] **Step 3: Add `sondergruppeId`/`sondergruppe`/`isDistrictWide` to the `Event` model**

In `prisma/schema.prisma`'s `model Event { ... }` block, find this existing block:

```prisma
  // Nur für category == DROHNENGRUPPE gesetzt: welche Drohnengruppe dieser Termin betrifft -
  // schränkt die Sichtbarkeit auf deren Mitglieder ein (siehe Task 8).
  droneGroupId String?
  droneGroup   DroneGroup? @relation(fields: [droneGroupId], references: [id])

  organization Organization   @relation(fields: [organizationId], references: [id])
```

Insert the two new fields between them:

```prisma
  // Nur für category == DROHNENGRUPPE gesetzt: welche Drohnengruppe dieser Termin betrifft -
  // schränkt die Sichtbarkeit auf deren Mitglieder ein (siehe Task 8).
  droneGroupId String?
  droneGroup   DroneGroup? @relation(fields: [droneGroupId], references: [id])

  // Nur für category == ALLGEMEIN relevant (siehe docs/superpowers/specs/
  // 2026-09-01-kalender-sondergruppen-design.md) - rein informative Zusatzkategorie
  // (Feuerwehrjugend/Schadstoffgruppe/Kommanden/...), fließt NICHT in canViewEvent/canManageEvent
  // ein. onDelete: SetNull, damit eine später deaktivierte/gelöschte Sondergruppe bestehende
  // Termine nicht blockiert.
  sondergruppeId String?
  sondergruppe   Sondergruppe? @relation(fields: [sondergruppeId], references: [id], onDelete: SetNull)

  // Dritte Geltungsbereichs-Stufe für category == ALLGEMEIN, additiv neben dem bestehenden
  // isSectionWide - siehe canViewEvent. Für category == DROHNENGRUPPE bleibt dies immer false
  // (Sichtbarkeit läuft dort ausschließlich über droneGroupId).
  isDistrictWide Boolean @default(false)

  organization Organization   @relation(fields: [organizationId], references: [id])
```

- [ ] **Step 4: Generate and apply the migration**

Run:

```bash
npm run db:migrate -- --name kalender_sondergruppen_bezirksweit
```

Expected: Prisma generates a new migration folder under `prisma/migrations/` and applies it to the local dev
database with no errors. Inspect the generated `migration.sql` and confirm it contains: a `CREATE TABLE
"Sondergruppe"` (with a unique constraint on `name` and on `sortOrder`), an `ALTER TABLE "Event" ADD COLUMN
"sondergruppeId" TEXT` plus the matching foreign key with `ON DELETE SET NULL`, an `ALTER TABLE "Event" ADD
COLUMN "isDistrictWide" BOOLEAN NOT NULL DEFAULT false`, and an `ALTER TABLE "User" ADD COLUMN
"ausgeblendeteSondergruppenIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`.

- [ ] **Step 5: Run `npx prisma generate` and confirm it succeeds**

```bash
npx prisma generate
```

Expected: exits 0, no errors. This regenerates the Prisma Client types so `prisma.sondergruppe`,
`Event.sondergruppeId`/`isDistrictWide`, and `User.ausgeblendeteSondergruppenIds` are available to
TypeScript for the following tasks.

- [ ] **Step 6: Seed the three initial `Sondergruppe` rows**

In `prisma/seed.ts`, find the existing `DIENSTGRADE` upsert loop:

```ts
  for (const { kurzform, bezeichnung, kategorie, sortOrder } of DIENSTGRADE) {
    await prisma.dienstgrad.upsert({
      where: { kurzform },
      update: { bezeichnung, kategorie, sortOrder },
      create: { kurzform, bezeichnung, kategorie, sortOrder },
    });
  }
```

Immediately after that loop (still before the `const adminEmail = ...` bootstrap-admin section), add:

```ts
  const SONDERGRUPPEN: { name: string; sortOrder: number }[] = [
    { name: 'Feuerwehrjugend', sortOrder: 10 },
    { name: 'Schadstoffgruppe', sortOrder: 20 },
    { name: 'Kommanden', sortOrder: 30 },
  ];
  for (const { name, sortOrder } of SONDERGRUPPEN) {
    await prisma.sondergruppe.upsert({
      where: { name },
      update: { sortOrder },
      create: { name, sortOrder },
    });
  }
```

- [ ] **Step 7: Run the seed and verify**

```bash
npm run db:seed
```

Expected: exits 0, no errors (idempotent — safe to have already run once for existing data). Then verify
directly against the database, e.g.:

```bash
npx prisma studio
```

or a one-off `psql`/script query confirming `Sondergruppe` has exactly 3 rows: `Feuerwehrjugend` (sortOrder
10), `Schadstoffgruppe` (sortOrder 20), `Kommanden` (sortOrder 30), all `isActive: true`.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts prisma/migrations
git commit -m "feat: add Sondergruppe model and Event/User fields for Kalender Sondergruppen"
```

---

## Task 2: Permissions + validation schema

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/validation/event.schema.ts`

**Interfaces:**
- Consumes: `SessionUser` (`user.isBezirksAdmin`, `user.abschnittAdminOrgIds`) from `@/types/next-auth`;
  `Event.sondergruppeId`/`Event.isDistrictWide` from Task 1.
- Produces: `canCreateBezirksWideEvent(user: SessionUser): boolean`, `canManageSondergruppenBezirksweit(user:
  SessionUser): boolean`, extended `canViewEvent(user, event)` (event param now requires `isDistrictWide:
  boolean`), extended `eventSchema`/`EventInput` (now includes `isDistrictWide: boolean`, `sondergruppeId:
  string | null`), extended `parseEventFormData(formData)` (now reads both). Task 3 and Task 6 call
  `canCreateBezirksWideEvent`; Task 7 calls `canManageSondergruppenBezirksweit`; Task 3/6 read the two new
  `EventInput`/`parseEventFormData` fields.

- [ ] **Step 1: Add `canCreateBezirksWideEvent` to `src/lib/auth/permissions.ts`**

Find the existing `canCreateAnySectionWideEvent` function:

```ts
/**
 * Reine UI-Vorabprüfung für die Termin-Formularseiten ("überhaupt ein Abschnitt-Recht?"), damit die
 * Checkbox/Kategorie-Auswahl gar nicht erst gerendert wird. Die eigentliche, abschnittsgenaue
 * Absicherung ist canCreateSectionWideEvent in den Server Actions - nicht diese Funktion.
 */
export function canCreateAnySectionWideEvent(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.abschnittAdminOrgIds.length > 0;
}
```

Immediately after it, add:

```ts
/**
 * Darf einen Bezirk-weiten (isDistrictWide) ALLGEMEIN-Termin anlegen/bearbeiten/löschen - Bezirksadmin
 * oder JEDER Abschnittsadmin (nicht nur für den eigenen Abschnitt - explizite Nutzerentscheidung, siehe
 * Design-Spec Abschnitt "Termin-Formular & Berechtigungen"). Bewusst eine eigene Funktion mit
 * identischem Körper zu canCreateAnySectionWideEvent statt deren Wiederverwendung: jene Funktion ist
 * eine reine UI-Vorabprüfung für die Abschnitt-weite Checkbox, diese hier ist die tatsächliche
 * serverseitige Durchsetzung für eine andere, unabhängige Geltungsbereichs-Stufe - beide dürfen sich
 * unabhängig voneinander weiterentwickeln, ohne sich gegenseitig zu beeinflussen. Sowohl UI-Vorprüfung
 * als auch serverseitige Durchsetzung, da es (anders als bei Abschnitt-weit) keinen sinnvollen
 * Zwischenschritt ("für WELCHEN Bezirk") gibt - es gibt nur einen Bezirk.
 */
export function canCreateBezirksWideEvent(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.abschnittAdminOrgIds.length > 0;
}
```

- [ ] **Step 2: Add `canManageSondergruppenBezirksweit`**

Find the existing `canManageFeuerwehrenBezirksweit` function:

```ts
/** Feuerwehren-Abschnitt (Anlegen/Umbenennen/Deaktivieren) + Bezirksadmin-Liste - exklusiv Bezirksadmin. */
export function canManageFeuerwehrenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}
```

Immediately after it, add:

```ts
/** Sondergruppen-Verwaltung (Anlegen/Umbenennen/Aktivieren/Deaktivieren) - exklusiv Bezirksadmin: eine
 * Sondergruppe ist (anders als DroneGroup) an keinem Abschnitt verankert, und es gibt keine eigene
 * Sondergruppen-Admin-Rolle (siehe Design-Spec). */
export function canManageSondergruppenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}
```

- [ ] **Step 3: Extend `canViewEvent`**

Find the existing function:

```ts
export function canViewEvent(
  user: SessionUser,
  event: {
    organizationId: string;
    isSectionWide: boolean;
    category: string;
    eventAbschnittOrganizationId: string;
    droneGroupId: string | null;
  },
): boolean {
  if (event.category === 'DROHNENGRUPPE') {
    return canViewDroneModule(user) && (event.droneGroupId === null || event.droneGroupId === user.droneGroupId);
  }
  return (
    event.organizationId === user.homeOrganizationId ||
    (event.isSectionWide && event.eventAbschnittOrganizationId === user.homeAbschnittOrganizationId)
  );
}
```

Replace its doc comment and body with:

```ts
/**
 * Sichtbarkeit eines einzelnen Termins - kategorieabhängig, identische Regel wie die
 * Kalenderübersicht-Query selbst (muss bei einer Änderung hier immer mitgezogen werden,
 * siehe kalender/page.tsx):
 * - Kategorie DROHNENGRUPPE ist VÖLLIG UNABHÄNGIG von organizationId/isSectionWide/isDistrictWide -
 *   sichtbar mit Modulzugriff UND (droneGroupId null [bezirksweit, alle 4 Gruppen] ODER droneGroupId
 *   exakt die eigene Gruppe).
 * - Kategorie ALLGEMEIN: eigene Feuerwehr ODER abschnittsweit innerhalb des eigenen Abschnitts ODER
 *   isDistrictWide (bezirksweit, sichtbar für jeden im Bezirk unabhängig von Organisation/Abschnitt -
 *   siehe docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md). `eventAbschnittOrganizationId`
 *   muss der Aufrufer selbst via getAbschnittOrganizationId(event.organization) berechnen - diese
 *   Funktion hat keinen DB-Zugriff.
 */
export function canViewEvent(
  user: SessionUser,
  event: {
    organizationId: string;
    isSectionWide: boolean;
    isDistrictWide: boolean;
    category: string;
    eventAbschnittOrganizationId: string;
    droneGroupId: string | null;
  },
): boolean {
  if (event.category === 'DROHNENGRUPPE') {
    return canViewDroneModule(user) && (event.droneGroupId === null || event.droneGroupId === user.droneGroupId);
  }
  return (
    event.organizationId === user.homeOrganizationId ||
    (event.isSectionWide && event.eventAbschnittOrganizationId === user.homeAbschnittOrganizationId) ||
    event.isDistrictWide
  );
}
```

Note: all three existing call sites (`src/app/(app)/kalender/[eventId]/rsvp-actions.ts`,
`src/app/(app)/kalender/[eventId]/page.tsx`, `src/app/(app)/kalender/[eventId]/ics/route.ts`) call this with
`{ ...event, eventAbschnittOrganizationId }` where `event` is a full, unfiltered `prisma.event.findUnique(...)`
row — since Task 1 added `isDistrictWide` as a real column on `Event`, the spread already includes it and
these three call sites need **no code changes**. Confirm this by running `npx tsc --noEmit` at the end of
this task (Step 6) — if any of the three broke, the `...event` spread at that call site was not a full row
and needs an explicit `isDistrictWide` added; investigate rather than assuming the note above always holds.

- [ ] **Step 4: Extend `eventSchema`/`parseEventFormData` in `src/lib/validation/event.schema.ts`**

Find the existing schema object:

```ts
export const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(200),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    location: z.string().trim().max(200).optional().or(z.literal('')),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
    allDay: z.boolean(),
    organizationId: z.string(),
    isSectionWide: z.boolean(),
    category: z.enum(EVENT_CATEGORIES),
    droneGroupId: z.string().nullable(),
  })
```

Replace with:

```ts
export const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(200),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    location: z.string().trim().max(200).optional().or(z.literal('')),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
    allDay: z.boolean(),
    organizationId: z.string(),
    isSectionWide: z.boolean(),
    // Dritte Geltungsbereichs-Stufe für category ALLGEMEIN, additiv neben isSectionWide - siehe
    // canViewEvent und docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md.
    isDistrictWide: z.boolean(),
    category: z.enum(EVENT_CATEGORIES),
    droneGroupId: z.string().nullable(),
    // Optionales Sondergruppen-Tag, nur für category ALLGEMEIN gedacht (siehe event-form.tsx) - null
    // heißt "keine Sondergruppe zugewiesen", fließt nicht in Sichtbarkeit/Berechtigung ein.
    sondergruppeId: z.string().nullable(),
  })
```

Find `parseEventFormData`:

```ts
export function parseEventFormData(formData: FormData) {
  const rawCategory = String(formData.get('category') ?? 'ALLGEMEIN');
  const rawDroneGroupId = String(formData.get('droneGroupId') ?? '');
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    location: String(formData.get('location') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    allDay: formData.get('allDay') === 'on',
    organizationId: String(formData.get('organizationId') ?? ''),
    isSectionWide: formData.get('isSectionWide') === 'on',
    category: (EVENT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as EventCategoryOption)
      : 'ALLGEMEIN',
    droneGroupId: rawDroneGroupId && rawDroneGroupId !== BEZIRKSWEIT_DRONE_GROUP_VALUE ? rawDroneGroupId : null,
  };
}
```

Replace with:

```ts
export function parseEventFormData(formData: FormData) {
  const rawCategory = String(formData.get('category') ?? 'ALLGEMEIN');
  const rawDroneGroupId = String(formData.get('droneGroupId') ?? '');
  const rawSondergruppeId = String(formData.get('sondergruppeId') ?? '');
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    location: String(formData.get('location') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    allDay: formData.get('allDay') === 'on',
    organizationId: String(formData.get('organizationId') ?? ''),
    isSectionWide: formData.get('isSectionWide') === 'on',
    isDistrictWide: formData.get('isDistrictWide') === 'on',
    category: (EVENT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as EventCategoryOption)
      : 'ALLGEMEIN',
    droneGroupId: rawDroneGroupId && rawDroneGroupId !== BEZIRKSWEIT_DRONE_GROUP_VALUE ? rawDroneGroupId : null,
    sondergruppeId: rawSondergruppeId ? rawSondergruppeId : null,
  };
}
```

- [ ] **Step 5: Confirm the two `.refine()` checks on `eventSchema` still need no changes**

Read the two existing `.refine()` calls right after the object schema (the `endsAt >= startsAt` check and the
`category === 'DROHNENGRUPPE' || organizationId.length > 0` check) — neither references `isSectionWide`,
`isDistrictWide`, or `sondergruppeId`, so neither needs editing. Confirm this by reading the file after your
edit and checking no `.refine()` block was accidentally altered.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
```

Expected: **will show type errors** in `src/app/(app)/kalender/actions.ts` (its two calls into
`prisma.event.create`/`update` no longer satisfy `EventInput`'s new required fields, and its `canManageEvent`/
`canManageEventsFor` calls are unaffected but `parseEventFormData`'s return type changed) — this is expected
and will be resolved by Task 3. Confirm the errors are **only** in `kalender/actions.ts` and nowhere else (if
`rsvp-actions.ts`/`kalender/[eventId]/page.tsx`/`kalender/[eventId]/ics/route.ts` show errors, investigate per
the note in Step 3 above rather than proceeding).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/permissions.ts src/lib/validation/event.schema.ts
git commit -m "feat: add Bezirk-weite Termine permission and extend event schema for Sondergruppen"
```

---

## Task 3: `kalender/actions.ts` — enforce and persist `isDistrictWide`/`sondergruppeId`

**Files:**
- Modify: `src/app/(app)/kalender/actions.ts`

**Interfaces:**
- Consumes: `canCreateBezirksWideEvent(user)` (Task 2), `EventInput.isDistrictWide`/`sondergruppeId` (Task 2),
  `prisma.sondergruppe` (Task 1).
- Produces: `createEvent`/`updateEvent`/`deleteEvent` now correctly enforce and persist the two new fields.
  No new exports.

- [ ] **Step 1: Import `canCreateBezirksWideEvent`**

Find the top-level import:

```ts
import { assertPermission, canCreateSectionWideEvent, canManageEvent, canManageEventsFor } from '@/lib/auth/permissions';
```

Replace with:

```ts
import {
  assertPermission,
  canCreateBezirksWideEvent,
  canCreateSectionWideEvent,
  canManageEvent,
  canManageEventsFor,
} from '@/lib/auth/permissions';
```

- [ ] **Step 2: `createEvent` — reset the two new fields explicitly in the DROHNENGRUPPE branch**

Find, inside `createEvent`, the DROHNENGRUPPE branch's `prisma.event.create` call:

```ts
    const created = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        category: data.category,
        droneGroupId: data.droneGroupId,
        createdById: user.id,
      },
    });
```

Replace with:

```ts
    const created = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        isDistrictWide: false,
        sondergruppeId: null,
        category: data.category,
        droneGroupId: data.droneGroupId,
        createdById: user.id,
      },
    });
```

- [ ] **Step 3: `createEvent` — enforce and persist for the ALLGEMEIN branch**

Find:

```ts
  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }

  const created = await prisma.event.create({
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      category: data.category,
      droneGroupId: null,
      createdById: user.id,
    },
  });
```

Replace with:

```ts
  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }
  if (data.isDistrictWide && !canCreateBezirksWideEvent(user)) {
    return { error: 'Keine Berechtigung für Bezirk-weite Termine.' };
  }
  if (data.sondergruppeId) {
    const sondergruppe = await prisma.sondergruppe.findUnique({ where: { id: data.sondergruppeId } });
    if (!sondergruppe) {
      return { error: 'Sondergruppe wurde nicht gefunden.' };
    }
  }

  const created = await prisma.event.create({
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      isDistrictWide: data.isDistrictWide,
      category: data.category,
      droneGroupId: null,
      sondergruppeId: data.sondergruppeId,
      createdById: user.id,
    },
  });
```

- [ ] **Step 4: `updateEvent` — check the existing event's `isDistrictWide` alongside `isSectionWide`**

Find, inside `updateEvent`, the initial permission-check block:

```ts
  if (existing.category === 'DROHNENGRUPPE') {
    const existingDroneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, existingDroneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const existingAbschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      if (!canCreateSectionWideEvent(user, existingAbschnittOrganizationId)) {
        return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
      }
    }
  }
```

Replace with:

```ts
  if (existing.category === 'DROHNENGRUPPE') {
    const existingDroneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, existingDroneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const existingAbschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      if (!canCreateSectionWideEvent(user, existingAbschnittOrganizationId)) {
        return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
      }
    }
    if (existing.isDistrictWide && !canCreateBezirksWideEvent(user)) {
      return { error: 'Keine Berechtigung, diesen Bezirk-weiten Termin zu bearbeiten.' };
    }
  }
```

- [ ] **Step 5: `updateEvent` — reset the two new fields explicitly in the DROHNENGRUPPE branch**

Find:

```ts
    const organizationId = droneGroup ? droneGroup.organizationId : existing.organizationId;
    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        category: data.category,
        droneGroupId: data.droneGroupId,
      },
    });
```

Replace with:

```ts
    const organizationId = droneGroup ? droneGroup.organizationId : existing.organizationId;
    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        isDistrictWide: false,
        sondergruppeId: null,
        category: data.category,
        droneGroupId: data.droneGroupId,
      },
    });
```

- [ ] **Step 6: `updateEvent` — enforce and persist for the ALLGEMEIN branch**

Find:

```ts
  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      category: data.category,
      droneGroupId: null,
    },
  });
```

Replace with:

```ts
  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }
  if (data.isDistrictWide && !canCreateBezirksWideEvent(user)) {
    return { error: 'Keine Berechtigung für Bezirk-weite Termine.' };
  }
  if (data.sondergruppeId) {
    const sondergruppe = await prisma.sondergruppe.findUnique({ where: { id: data.sondergruppeId } });
    if (!sondergruppe) {
      return { error: 'Sondergruppe wurde nicht gefunden.' };
    }
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      isDistrictWide: data.isDistrictWide,
      category: data.category,
      droneGroupId: null,
      sondergruppeId: data.sondergruppeId,
    },
  });
```

- [ ] **Step 7: `deleteEvent` — check `isDistrictWide` alongside `isSectionWide`**

Find:

```ts
  if (existing.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, droneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const abschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      assertPermission(canCreateSectionWideEvent(user, abschnittOrganizationId));
    }
  }
```

Replace with:

```ts
  if (existing.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, droneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const abschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      assertPermission(canCreateSectionWideEvent(user, abschnittOrganizationId));
    }
    if (existing.isDistrictWide) {
      assertPermission(canCreateBezirksWideEvent(user));
    }
  }
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean, zero errors (this resolves the errors Task 2 Step 6 expected to see here).

Then verify directly against the local dev database with a throwaway script (delete it afterward) that:
1. A synthetic `SessionUser`-shaped object for a plain Feuerwehr-Admin (no `abschnittAdminOrgIds`, not
   `isBezirksAdmin`) passed through `canCreateBezirksWideEvent` returns `false`.
2. The same for a synthetic Abschnittsadmin (`abschnittAdminOrgIds: ['some-id']`) returns `true`.
3. Calling `createEvent` (via its exported function directly, constructing a `FormData` with
   `isDistrictWide=on` and no `sondergruppeId`) as the Feuerwehr-Admin returns `{ error: 'Keine Berechtigung
   für Bezirk-weite Termine.' }` and creates no row.
4. The same call as the Abschnittsadmin actually creates a row with `isDistrictWide: true`,
   `isSectionWide: false`, `sondergruppeId: null`.
5. Creating an event with `sondergruppeId` set to one of the 3 seeded Sondergruppe ids persists it correctly
   on the created row.

- [ ] **Step 9: Commit**

```bash
git add src/app/\(app\)/kalender/actions.ts
git commit -m "feat: enforce and persist Bezirk-weite Termine and Sondergruppen in kalender actions"
```

---

## Task 4: Visibility propagation (the "Bezirk-weit" OR-condition everywhere)

**Files:**
- Modify: `src/app/(app)/kalender/page.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`
- Modify: `src/app/(app)/kalender/ics/[token]/route.ts`
- Modify: `src/lib/push/audience.ts`
- Modify: `src/lib/push/send-event-push.ts`
- Modify: `src/lib/calendar/layer-colors.ts`
- Modify: `src/components/calendar/layer-legend.tsx`

**Interfaces:**
- Consumes: `Event.isDistrictWide` (Task 1).
- Produces: a new `'bezirk'` calendar layer (color `#5856d6`, label `'Bezirk-weit'`) alongside the existing
  `own`/`abschnitt`/`drohnengruppe` layers — read by `kalender/page.tsx`, `LayerLegend`, and (from Task 5
  onward) `KalenderFiltersContent`/`KalenderDesktopSidebar`'s Ebenen-Toggle list via the `layers` prop
  `kalender/page.tsx` already builds and passes down.

- [ ] **Step 1: `src/lib/calendar/layer-colors.ts` — add the `bezirk` layer**

Replace the whole file with:

```ts
/** Shared by kalender/page.tsx (event backgroundColor), LayerLegend, and EventCard's accent bar, so
 * the three can never disagree on what color a layer is. */
export const LAYER_COLORS: Record<string, string> = {
  own: '#1c1c1e',
  abschnitt: '#e4322b',
  bezirk: '#5856d6',
  drohnengruppe: '#22a06b',
};

export const LAYER_LABELS: Record<string, string> = {
  own: 'Meine Feuerwehr',
  abschnitt: 'Abschnitt-Kalender',
  bezirk: 'Bezirk-weit',
  drohnengruppe: 'Drohnengruppe',
};
```

- [ ] **Step 2: `src/components/calendar/layer-legend.tsx` — include `bezirk` in the legend**

Find:

```ts
  const keys = showDrone ? (['own', 'abschnitt', 'drohnengruppe'] as const) : (['own', 'abschnitt'] as const);
```

Replace with:

```ts
  const keys = showDrone
    ? (['own', 'abschnitt', 'bezirk', 'drohnengruppe'] as const)
    : (['own', 'abschnitt', 'bezirk'] as const);
```

- [ ] **Step 3: `kalender/page.tsx` — add the visibility OR-branch, the `bezirk` layer, and layer tagging**

Find the event query's `where.OR` array:

```ts
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
          // Drohnengruppen-Termine sind komplett unabhängig von Organisation/Abschnitt sichtbar (siehe
          // canViewEvent) - eigene Gruppe ODER bezirksweit (droneGroupId null), unabhängig davon, bei
          // welcher Feuerwehr/Abschnitt das Event technisch "organizationId" trägt.
          ...(canSeeDroneCategory
            ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }]
            : []),
        ],
      },
```

Replace with:

```ts
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
          // Bezirk-weite ALLGEMEIN-Termine sind für jeden im Bezirk sichtbar, unabhängig von
          // Organisation/Abschnitt (siehe canViewEvent, docs/superpowers/specs/
          // 2026-09-01-kalender-sondergruppen-design.md).
          { category: 'ALLGEMEIN' as const, isDistrictWide: true },
          // Drohnengruppen-Termine sind komplett unabhängig von Organisation/Abschnitt sichtbar (siehe
          // canViewEvent) - eigene Gruppe ODER bezirksweit (droneGroupId null), unabhängig davon, bei
          // welcher Feuerwehr/Abschnitt das Event technisch "organizationId" trägt.
          ...(canSeeDroneCategory
            ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }]
            : []),
        ],
      },
```

Then find the `layers` array:

```ts
  const layers: CalendarLayer[] = [
    { key: 'own', label: 'Meine Feuerwehr' },
    { key: 'abschnitt', label: 'Abschnitt-Kalender' },
  ];
  if (canSeeDroneCategory) {
    layers.push({ key: 'drohnengruppe', label: 'Drohnengruppe' });
  }
```

Replace with:

```ts
  const layers: CalendarLayer[] = [
    { key: 'own', label: 'Meine Feuerwehr' },
    { key: 'abschnitt', label: 'Abschnitt-Kalender' },
    { key: 'bezirk', label: 'Bezirk-weit' },
  ];
  if (canSeeDroneCategory) {
    layers.push({ key: 'drohnengruppe', label: 'Drohnengruppe' });
  }
```

Then find the layer computation inside the `.map()`:

```ts
    .map((event) => {
      const layer = event.category === 'DROHNENGRUPPE' ? 'drohnengruppe' : event.isSectionWide ? 'abschnitt' : 'own';
```

Replace with:

```ts
    .map((event) => {
      const layer =
        event.category === 'DROHNENGRUPPE'
          ? 'drohnengruppe'
          : event.isDistrictWide
            ? 'bezirk'
            : event.isSectionWide
              ? 'abschnitt'
              : 'own';
```

- [ ] **Step 4: `meine-feuerwehr/page.tsx` — add the same OR-branch**

Find:

```ts
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
          ...(droneMember
            ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }]
            : []),
        ],
        endsAt: { gte: now },
      },
```

Replace with:

```ts
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
          { category: 'ALLGEMEIN' as const, isDistrictWide: true },
          ...(droneMember
            ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }]
            : []),
        ],
        endsAt: { gte: now },
      },
```

- [ ] **Step 5: `kalender/ics/[token]/route.ts` — add the OR-branch to both queries**

Find the legacy combined feed's query:

```ts
    const events = await prisma.event.findMany({
      where: {
        isSectionWide: true,
        category: { not: 'DROHNENGRUPPE' },
        organization: { OR: [{ id: abschnitt.id }, { parentId: abschnitt.id }] },
      },
      orderBy: { startsAt: 'asc' },
    });
```

Replace with:

```ts
    const events = await prisma.event.findMany({
      where: {
        category: { not: 'DROHNENGRUPPE' },
        OR: [
          { isSectionWide: true, organization: { OR: [{ id: abschnitt.id }, { parentId: abschnitt.id }] } },
          { isDistrictWide: true },
        ],
      },
      orderBy: { startsAt: 'asc' },
    });
```

Then find the per-organization feed's query:

```ts
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { organizationId: organization.id },
        {
          isSectionWide: true,
          organization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
        },
      ],
      category: { not: 'DROHNENGRUPPE' },
    },
    orderBy: { startsAt: 'asc' },
  });
```

Replace with:

```ts
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { organizationId: organization.id },
        {
          isSectionWide: true,
          organization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
        },
        { isDistrictWide: true },
      ],
      category: { not: 'DROHNENGRUPPE' },
    },
    orderBy: { startsAt: 'asc' },
  });
```

- [ ] **Step 6: `src/lib/push/send-event-push.ts` — extend `EventForPush`**

Find:

```ts
export interface EventForPush {
  id: string;
  title: string;
  startsAt: Date;
  location: string | null;
  organizationId: string;
  isSectionWide: boolean;
  category: string;
  droneGroupId: string | null;
}
```

Replace with:

```ts
export interface EventForPush {
  id: string;
  title: string;
  startsAt: Date;
  location: string | null;
  organizationId: string;
  isSectionWide: boolean;
  isDistrictWide: boolean;
  category: string;
  droneGroupId: string | null;
}
```

- [ ] **Step 7: `src/lib/push/audience.ts` — resolve the Bezirk-weit audience**

Find:

```ts
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  category: string;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    // ... unchanged DROHNENGRUPPE branch ...
  }

  // Die Organisations-/Abschnittshälfte der Sichtbarkeitsregel - identisch zu canViewEvent:
  // eigene Feuerwehr ODER (abschnittsweit UND im selben Abschnitt). Bei einem abschnittsweiten Termin
  // umfasst die Abschnittsbedingung die eigene-Feuerwehr-Bedingung bereits vollständig.
  let visibilityWhere: Prisma.UserWhereInput;
  if (event.isSectionWide) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: event.organizationId },
      select: { type: true, id: true, parentId: true },
    });
    const abschnittOrganizationId = getAbschnittOrganizationId(organization);
    visibilityWhere = {
      homeOrganization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
    };
  } else {
    visibilityWhere = { homeOrganizationId: event.organizationId };
  }

  const members = await prisma.user.findMany({ where: { isActive: true, ...visibilityWhere }, select: { id: true } });
  return members.map((member) => member.id);
}
```

Replace the function signature and the ALLGEMEIN half's body (leave the DROHNENGRUPPE `if` block itself
completely untouched) with:

```ts
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  isDistrictWide: boolean;
  category: string;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    // ... unchanged DROHNENGRUPPE branch, do not edit ...
  }

  // Die Organisations-/Abschnitts-/Bezirkshälfte der Sichtbarkeitsregel - identisch zu canViewEvent:
  // eigene Feuerwehr ODER (abschnittsweit UND im selben Abschnitt) ODER bezirksweit (jedes aktive
  // Mitglied). Bei einem abschnittsweiten Termin umfasst die Abschnittsbedingung die
  // eigene-Feuerwehr-Bedingung bereits vollständig; bei einem bezirksweiten Termin die
  // Abschnittsbedingung ebenfalls.
  let visibilityWhere: Prisma.UserWhereInput;
  if (event.isDistrictWide) {
    visibilityWhere = {};
  } else if (event.isSectionWide) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: event.organizationId },
      select: { type: true, id: true, parentId: true },
    });
    const abschnittOrganizationId = getAbschnittOrganizationId(organization);
    visibilityWhere = {
      homeOrganization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
    };
  } else {
    visibilityWhere = { homeOrganizationId: event.organizationId };
  }

  const members = await prisma.user.findMany({ where: { isActive: true, ...visibilityWhere }, select: { id: true } });
  return members.map((member) => member.id);
}
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean. `sendEventPushNow`'s call site (`triggerEventPushNotification` in
`kalender/[eventId]/rsvp-actions.ts`) passes the full Prisma `Event` row through, which now structurally
includes `isDistrictWide` — confirm no error there; if there is one, the row being passed is not a full
`prisma.event.findUnique(...)` result and needs an explicit `isDistrictWide` added at that call site.

Then verify directly against the local dev database with a throwaway script (delete it afterward):
1. Insert one `ALLGEMEIN` event with `isDistrictWide: true` anchored at some Feuerwehr the test user is NOT a
   member of and not in their Abschnitt. Query `kalender/page.tsx`'s exact `where` clause for a different
   test user (different Abschnitt) and confirm it's included.
2. Call `resolveEventAudienceUserIds` on that event and confirm the returned id list includes users from
   multiple different Abschnitte (not scoped to one).
3. Fetch the legacy and per-organization `.ics` feed routes' queries directly and confirm the bezirksweite
   event appears in both.
4. Confirm a Drohnengruppen-only regression check still passes: a non-drone-member user's `kalender/page.tsx`
   query result contains zero `DROHNENGRUPPE` events (unrelated to this change, but confirms the OR-array
   edit didn't accidentally widen that branch).

- [ ] **Step 9: Commit**

```bash
git add src/app/\(app\)/kalender/page.tsx src/app/\(app\)/meine-feuerwehr/page.tsx src/app/\(app\)/kalender/ics/\[token\]/route.ts src/lib/push/audience.ts src/lib/push/send-event-push.ts src/lib/calendar/layer-colors.ts src/components/calendar/layer-legend.tsx
git commit -m "feat: propagate Bezirk-weite Termine visibility to every ALLGEMEIN query call site"
```

---

## Task 5: Personal Sondergruppen filter (persisted, client-side display filter)

**Files:**
- Create: `src/app/(app)/kalender/sondergruppen-filter-actions.ts`
- Modify: `src/components/calendar/calendar-view.tsx`
- Modify: `src/components/calendar/kalender-with-layers.tsx`
- Modify: `src/components/calendar/kalender-with-layers-online.tsx`
- Modify: `src/components/calendar/kalender-filters-content.tsx`
- Modify: `src/components/calendar/kalender-desktop-sidebar.tsx`
- Modify: `src/app/(app)/kalender/page.tsx`

**Interfaces:**
- Consumes: `User.ausgeblendeteSondergruppenIds` (Task 1), `prisma.sondergruppe` (Task 1).
- Produces: `setSondergruppenFilter(sondergruppeId: string, hidden: boolean): Promise<void>`; new
  `SondergruppeOption` type (`{ id: string; name: string }`) exported from `kalender-with-layers.tsx`;
  `KalenderWithLayers`/`KalenderWithLayersOnline` gain optional `sondergruppen`/
  `initialHiddenSondergruppenIds` props; `CalendarEventInput` gains `sondergruppeId?: string | null`.

- [ ] **Step 1: Create the Server Action**

Create `src/app/(app)/kalender/sondergruppen-filter-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';

/**
 * Persistiert die persönliche Sondergruppen-Filtereinstellung (welche Sondergruppen dieses Mitglied im
 * eigenen Kalender ausblendet) - direkt aufgerufen wie setRsvp, kein Formular-Submit nötig. Lädt den
 * aktuellen Stand vor dem Schreiben und schreibt das komplette Array neu, statt eines reinen Prisma-
 * `push`, der bei hidden=true bei einem schnellen Doppelklick sonst dieselbe Id mehrfach anhängen
 * könnte. Reine Anzeige-Einstellung, keine Sicherheitsprüfung nötig (siehe Design-Spec) - jeder
 * eingeloggte Nutzer darf seine eigene Einstellung jederzeit ändern.
 */
export async function setSondergruppenFilter(sondergruppeId: string, hidden: boolean): Promise<void> {
  const user = await requireUser();
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { ausgeblendeteSondergruppenIds: true },
  });
  const withoutId = current.ausgeblendeteSondergruppenIds.filter((id) => id !== sondergruppeId);
  const next = hidden ? [...withoutId, sondergruppeId] : withoutId;
  await prisma.user.update({
    where: { id: user.id },
    data: { ausgeblendeteSondergruppenIds: next },
  });
  revalidatePath('/kalender');
}
```

- [ ] **Step 2: `calendar-view.tsx` — add `sondergruppeId` to `CalendarEventInput`**

Find:

```ts
export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  editable: boolean;
  backgroundColor?: string;
  description?: string;
  location?: string;
  organizationName?: string;
  category?: string;
  layer?: string;
  myRsvpStatus?: 'ZUGESAGT' | 'ABGESAGT' | 'UNKLAR' | null;
  rsvpCounts?: { ZUGESAGT: number; ABGESAGT: number; UNKLAR: number };
  isVehicleBooking?: boolean;
  isDistrictWideDrone?: boolean;
}
```

Replace with:

```ts
export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  editable: boolean;
  backgroundColor?: string;
  description?: string;
  location?: string;
  organizationName?: string;
  category?: string;
  layer?: string;
  myRsvpStatus?: 'ZUGESAGT' | 'ABGESAGT' | 'UNKLAR' | null;
  rsvpCounts?: { ZUGESAGT: number; ABGESAGT: number; UNKLAR: number };
  isVehicleBooking?: boolean;
  isDistrictWideDrone?: boolean;
  sondergruppeId?: string | null;
}
```

- [ ] **Step 3: `kalender-with-layers.tsx` — accept the new props, filter, and render the toggle UI plumbing**

Find the top imports and the `CalendarLayer`/`StatusFilter` exports:

```ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarView, type CalendarEventInput } from './calendar-view';
import { EventListView } from './event-list-view';
import { KalenderFiltersContent } from './kalender-filters-content';
import { KalenderDesktopSidebar } from './kalender-desktop-sidebar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useMobileHeader } from '@/components/layout/mobile-header-context';

export interface CalendarLayer {
  key: string;
  label: string;
}

export type StatusFilter = 'ALLE' | 'OFFEN' | 'ZUGESAGT';

interface KalenderWithLayersProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
  readOnly?: boolean;
  onNavigate?: (path: string) => void;
}
```

Replace with:

```ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarView, type CalendarEventInput } from './calendar-view';
import { EventListView } from './event-list-view';
import { KalenderFiltersContent } from './kalender-filters-content';
import { KalenderDesktopSidebar } from './kalender-desktop-sidebar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useMobileHeader } from '@/components/layout/mobile-header-context';

export interface CalendarLayer {
  key: string;
  label: string;
}

export interface SondergruppeOption {
  id: string;
  name: string;
}

export type StatusFilter = 'ALLE' | 'OFFEN' | 'ZUGESAGT';

interface KalenderWithLayersProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
  sondergruppen?: SondergruppeOption[];
  initialHiddenSondergruppenIds?: string[];
  onToggleSondergruppe?: (sondergruppeId: string, hidden: boolean) => void;
  readOnly?: boolean;
  onNavigate?: (path: string) => void;
}
```

Find the function signature and its initial state:

```ts
export function KalenderWithLayers({ events, layers, readOnly = false, onNavigate }: KalenderWithLayersProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.key, true])),
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALLE');
  const [sheetOpen, setSheetOpen] = useState(false);
  const { setActionSlot } = useMobileHeader();
```

Replace with:

```ts
export function KalenderWithLayers({
  events,
  layers,
  sondergruppen = [],
  initialHiddenSondergruppenIds = [],
  onToggleSondergruppe,
  readOnly = false,
  onNavigate,
}: KalenderWithLayersProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.key, true])),
  );
  // Opt-in-Standard (siehe Design-Spec "Persönlicher Filter"): ein leeres
  // initialHiddenSondergruppenIds bedeutet "noch nie eine Auswahl getroffen", NICHT "alles
  // anzeigen" - in diesem Fall gelten alle aktuell bekannten Sondergruppen als ausgeblendet. Ein
  // NICHT-leeres initialHiddenSondergruppenIds ist dagegen die echte, gespeicherte Wahl des
  // Mitglieds und wird unverändert übernommen, auch wenn sie inzwischen eine Sondergruppe nennt,
  // die aus `sondergruppen` verschwunden ist (z. B. deaktiviert).
  const [hiddenSondergruppen, setHiddenSondergruppen] = useState<Set<string>>(
    () =>
      new Set(
        initialHiddenSondergruppenIds.length > 0
          ? initialHiddenSondergruppenIds
          : sondergruppen.map((gruppe) => gruppe.id),
      ),
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALLE');
  const [sheetOpen, setSheetOpen] = useState(false);
  const { setActionSlot } = useMobileHeader();
```

Find the `filteredEvents` memo:

```ts
  // Vergangene Termine werden nur in der Listenansicht ausgeblendet (siehe Issue #1) - fest, ohne
  // Umschalter. Die Kalenderansicht (Gitter) zeigt weiterhin jeden Monat vollständig, da ein
  // Kalendergitter mit ausgeblendeten vergangenen Tagen/Terminen eher verwirrend als aufgeräumt wirkt.
  const filteredEvents = useMemo(
    () => events.filter((event) => enabled[event.layer ?? ''] !== false),
    [events, enabled],
  );
```

Replace with:

```ts
  // Vergangene Termine werden nur in der Listenansicht ausgeblendet (siehe Issue #1) - fest, ohne
  // Umschalter. Die Kalenderansicht (Gitter) zeigt weiterhin jeden Monat vollständig, da ein
  // Kalendergitter mit ausgeblendeten vergangenen Tagen/Terminen eher verwirrend als aufgeräumt wirkt.
  // Sondergruppen-Filter (siehe docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md) ist
  // rein clientseitig, unabhängig vom Ebenen-Toggle - ein Termin ohne sondergruppeId ist davon nie
  // betroffen.
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          enabled[event.layer ?? ''] !== false &&
          (!event.sondergruppeId || !hiddenSondergruppen.has(event.sondergruppeId)),
      ),
    [events, enabled, hiddenSondergruppen],
  );
```

Find the `handleToggle` function:

```ts
  function handleToggle(key: string, checked: boolean) {
    setEnabled((prev) => ({ ...prev, [key]: checked }));
  }
```

Immediately after it, add:

```ts
  function handleSondergruppeToggle(sondergruppeId: string, visible: boolean) {
    setHiddenSondergruppen((prev) => {
      const next = new Set(prev);
      if (visible) {
        next.delete(sondergruppeId);
      } else {
        next.add(sondergruppeId);
      }
      return next;
    });
    onToggleSondergruppe?.(sondergruppeId, !visible);
  }
```

Find both places `<KalenderDesktopSidebar` and `<KalenderFiltersContent` are rendered:

```tsx
      <div className="hidden lg:flex lg:w-64 lg:shrink-0">
        <KalenderDesktopSidebar
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          openCount={openCount}
        />
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Kalender-Ebenen">
        <KalenderFiltersContent
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
        />
      </BottomSheet>
```

Replace with:

```tsx
      <div className="hidden lg:flex lg:w-64 lg:shrink-0">
        <KalenderDesktopSidebar
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          openCount={openCount}
          sondergruppen={sondergruppen}
          hiddenSondergruppen={hiddenSondergruppen}
          onSondergruppeToggle={handleSondergruppeToggle}
        />
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Kalender-Ebenen">
        <KalenderFiltersContent
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          sondergruppen={sondergruppen}
          hiddenSondergruppen={hiddenSondergruppen}
          onSondergruppeToggle={handleSondergruppeToggle}
        />
      </BottomSheet>
```

- [ ] **Step 4: `kalender-filters-content.tsx` — render the Sondergruppen section**

Find:

```tsx
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { LayerLegend } from './layer-legend';
import type { CalendarLayer } from './kalender-with-layers';

interface KalenderFiltersContentProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
}
```

Replace with:

```tsx
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { LayerLegend } from './layer-legend';
import type { CalendarLayer, SondergruppeOption } from './kalender-with-layers';

interface KalenderFiltersContentProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  sondergruppen: SondergruppeOption[];
  hiddenSondergruppen: Set<string>;
  onSondergruppeToggle: (sondergruppeId: string, visible: boolean) => void;
}
```

Find:

```tsx
export function KalenderFiltersContent({
  layers,
  enabled,
  onToggle,
  showDrone,
}: KalenderFiltersContentProps) {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {layers.length > 1 && (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:rounded-lg sm:p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ebenen</span>
          {layers.map((layer) => (
            <ToggleSwitch
              key={layer.key}
              label={layer.label}
              checked={enabled[layer.key] ?? true}
              onChange={(checked) => onToggle(layer.key, checked)}
            />
          ))}
          {showDrone && (
            <p className="text-xs text-neutral-400">
              Termine der Kategorie Drohnengruppe sind nur für Mitglieder der Drohnengruppe sichtbar.
            </p>
          )}
        </div>
      )}

      <LayerLegend showDrone={showDrone} />
    </div>
  );
}
```

Replace with:

```tsx
export function KalenderFiltersContent({
  layers,
  enabled,
  onToggle,
  showDrone,
  sondergruppen,
  hiddenSondergruppen,
  onSondergruppeToggle,
}: KalenderFiltersContentProps) {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {layers.length > 1 && (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:rounded-lg sm:p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ebenen</span>
          {layers.map((layer) => (
            <ToggleSwitch
              key={layer.key}
              label={layer.label}
              checked={enabled[layer.key] ?? true}
              onChange={(checked) => onToggle(layer.key, checked)}
            />
          ))}
          {showDrone && (
            <p className="text-xs text-neutral-400">
              Termine der Kategorie Drohnengruppe sind nur für Mitglieder der Drohnengruppe sichtbar.
            </p>
          )}
        </div>
      )}

      {sondergruppen.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:rounded-lg sm:p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Sondergruppen</span>
          {sondergruppen.map((gruppe) => (
            <ToggleSwitch
              key={gruppe.id}
              label={gruppe.name}
              checked={!hiddenSondergruppen.has(gruppe.id)}
              onChange={(checked) => onSondergruppeToggle(gruppe.id, checked)}
            />
          ))}
        </div>
      )}

      <LayerLegend showDrone={showDrone} />
    </div>
  );
}
```

- [ ] **Step 5: `kalender-desktop-sidebar.tsx` — render the same Sondergruppen section**

Find:

```tsx
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { CalendarLayer, StatusFilter } from './kalender-with-layers';

interface KalenderDesktopSidebarProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  openCount: number;
}
```

Replace with:

```tsx
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { CalendarLayer, SondergruppeOption, StatusFilter } from './kalender-with-layers';

interface KalenderDesktopSidebarProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  openCount: number;
  sondergruppen: SondergruppeOption[];
  hiddenSondergruppen: Set<string>;
  onSondergruppeToggle: (sondergruppeId: string, visible: boolean) => void;
}
```

Find the function signature:

```tsx
export function KalenderDesktopSidebar({
  layers,
  enabled,
  onToggle,
  showDrone,
  statusFilter,
  onStatusFilterChange,
  openCount,
}: KalenderDesktopSidebarProps) {
```

Replace with:

```tsx
export function KalenderDesktopSidebar({
  layers,
  enabled,
  onToggle,
  showDrone,
  statusFilter,
  onStatusFilterChange,
  openCount,
  sondergruppen,
  hiddenSondergruppen,
  onSondergruppeToggle,
}: KalenderDesktopSidebarProps) {
```

Find the closing of the Ebenen card (right before the "Nur anzeigen" card):

```tsx
          <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
            Die Farbe links am Termin zeigt die Ebene. Drohnengruppen-Termine sehen nur deren Mitglieder.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Nur anzeigen</span>
```

Replace with:

```tsx
          <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
            Die Farbe links am Termin zeigt die Ebene. Drohnengruppen-Termine sehen nur deren Mitglieder.
          </p>
        </div>
      )}

      {sondergruppen.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Sondergruppen</span>
          {sondergruppen.map((gruppe) => (
            <ToggleSwitch
              key={gruppe.id}
              label={gruppe.name}
              checked={!hiddenSondergruppen.has(gruppe.id)}
              onChange={(checked) => onSondergruppeToggle(gruppe.id, checked)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Nur anzeigen</span>
```

- [ ] **Step 6: `kalender-with-layers-online.tsx` — wire the Server Action**

Replace the whole file with:

```tsx
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KalenderWithLayers, type CalendarLayer, type SondergruppeOption } from './kalender-with-layers';
import { OfflineCacheSync } from './offline-cache-sync';
import { setSondergruppenFilter } from '@/app/(app)/kalender/sondergruppen-filter-actions';
import type { CalendarEventInput } from './calendar-view';

interface KalenderWithLayersOnlineProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
  sondergruppen?: SondergruppeOption[];
  initialHiddenSondergruppenIds?: string[];
}

/**
 * Next.js-spezifischer Adapter für KalenderWithLayers: liefert die echte router.push-Navigation und
 * die Server-Action-Persistenz der Sondergruppen-Filtereinstellung. KalenderWithLayers selbst bleibt
 * dadurch frei von next/navigation/Server Actions und ist so auch von der `/offline-kalender`-Route
 * (über den erweiterten Service Worker, public/sw.js, ausgeliefert) ohne Navigation/Persistenz
 * (readOnly) wiederverwendbar - siehe docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
 */
export function KalenderWithLayersOnline({
  events,
  layers,
  sondergruppen,
  initialHiddenSondergruppenIds,
}: KalenderWithLayersOnlineProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <>
      <OfflineCacheSync events={events} layers={layers} />
      <KalenderWithLayers
        events={events}
        layers={layers}
        sondergruppen={sondergruppen}
        initialHiddenSondergruppenIds={initialHiddenSondergruppenIds}
        onToggleSondergruppe={(sondergruppeId, hidden) =>
          startTransition(() => {
            void setSondergruppenFilter(sondergruppeId, hidden);
          })
        }
        onNavigate={(path) => router.push(path)}
      />
    </>
  );
}
```

- [ ] **Step 7: `kalender/page.tsx` — fetch and pass the two new props**

Find the top-level `Promise.all` fetch:

```ts
  const [organization, allEvents, droneGroups] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.event.findMany({
```

Replace with:

```ts
  const [organization, allEvents, droneGroups, sondergruppen, currentUser] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.event.findMany({
```

Then find the closing of that same `Promise.all` array (after the `droneGroups` fetch, before the closing
`]);`):

```ts
    canSeeDroneCategory
      ? prisma.droneGroup.findMany({ select: { id: true, organizationId: true } })
      : Promise.resolve([]),
  ]);
```

Replace with:

```ts
    canSeeDroneCategory
      ? prisma.droneGroup.findMany({ select: { id: true, organizationId: true } })
      : Promise.resolve([]),
    prisma.sondergruppe.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { ausgeblendeteSondergruppenIds: true },
    }),
  ]);
```

Find the `CalendarEventInput` object literal inside the `.map()`:

```ts
      return {
        id: event.id,
        title: event.title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        allDay: event.allDay,
        editable: canManageEvent(user, event, droneGroup) && !event.vehicleBookingId && !event.icsUid,
        backgroundColor: LAYER_COLORS[layer],
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
        myRsvpStatus: myRsvpByEvent.get(event.id) ?? null,
        rsvpCounts: rsvpCountsByEvent.get(event.id) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 },
        isVehicleBooking: event.vehicleBookingId !== null,
        isDistrictWideDrone: event.category === 'DROHNENGRUPPE' && event.droneGroupId === null,
      };
```

Replace with:

```ts
      return {
        id: event.id,
        title: event.title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        allDay: event.allDay,
        editable: canManageEvent(user, event, droneGroup) && !event.vehicleBookingId && !event.icsUid,
        backgroundColor: LAYER_COLORS[layer],
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
        myRsvpStatus: myRsvpByEvent.get(event.id) ?? null,
        rsvpCounts: rsvpCountsByEvent.get(event.id) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 },
        isVehicleBooking: event.vehicleBookingId !== null,
        isDistrictWideDrone: event.category === 'DROHNENGRUPPE' && event.droneGroupId === null,
        sondergruppeId: event.sondergruppeId,
      };
```

Find the final render:

```tsx
      <KalenderWithLayersOnline events={calendarEvents} layers={layers} />
```

Replace with:

```tsx
      <KalenderWithLayersOnline
        events={calendarEvents}
        layers={layers}
        sondergruppen={sondergruppen}
        initialHiddenSondergruppenIds={currentUser.ausgeblendeteSondergruppenIds}
      />
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

Then start the dev server (`npm run dev`) and verify manually against the local dev database:
1. Insert a real `ALLGEMEIN` event tagged with one of the 3 seeded Sondergruppen (e.g.
   `Feuerwehrjugend`), visible to the logged-in test user (own org or bezirksweit).
2. Load `/kalender` and confirm a new "Sondergruppen" card/section appears (desktop `lg:` sidebar and,
   below `lg:`, inside the mobile/tablet filter Bottom Sheet) listing `Feuerwehrjugend`/`Schadstoffgruppe`/
   `Kommanden`.
3. Confirm the default state (a user who has never touched the filter, `ausgeblendeteSondergruppenIds: []`)
   shows every Sondergruppe toggle **unchecked** ("ausgeblendet") and the tagged event from step 1 **hidden**
   from both the list and grid views — per the design's "leeres Array bedeutet alle ausgeblendet" opt-in
   rule. If the tagged event is visible by default at this checkpoint, `hiddenSondergruppen`'s initial state
   in `kalender-with-layers.tsx` is not falling back to "all known Sondergruppen" for an empty
   `initialHiddenSondergruppenIds` — fix that before proceeding, do not defer it.
4. Toggle the checkbox off for `Feuerwehrjugend` and confirm the tagged event disappears from both the list
   and grid views without a page reload.
5. Reload the page and confirm the setting persisted (query `User.ausgeblendeteSondergruppenIds` directly in
   the database for the test user and confirm the id is present).

- [ ] **Step 9: Commit**

```bash
git add src/app/\(app\)/kalender/sondergruppen-filter-actions.ts src/components/calendar/calendar-view.tsx src/components/calendar/kalender-with-layers.tsx src/components/calendar/kalender-with-layers-online.tsx src/components/calendar/kalender-filters-content.tsx src/components/calendar/kalender-desktop-sidebar.tsx src/app/\(app\)/kalender/page.tsx
git commit -m "feat: add persisted personal Sondergruppen filter to Kalender"
```

---

## Task 6: `event-form.tsx` UI — 3-way Geltungsbereich + Sondergruppe select

**Files:**
- Create: `src/lib/calendar/sondergruppe-options.ts`
- Modify: `src/components/calendar/event-form.tsx`
- Modify: `src/app/(app)/kalender/neu/page.tsx`
- Modify: `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx`

**Interfaces:**
- Consumes: `canCreateBezirksWideEvent(user)` (Task 2), `EventInput.isDistrictWide`/`sondergruppeId` (Task
  2), `prisma.sondergruppe` (Task 1).
- Produces: `getSondergruppeOptions(currentSondergruppeId?: string | null): Promise<{id, name}[]>`;
  `EventForm` gains `canDistrictWide: boolean` and `sondergruppeOptions: {id, name}[]` props.

- [ ] **Step 1: Create `src/lib/calendar/sondergruppe-options.ts`**

```ts
import { prisma } from '@/lib/db/prisma';

export interface SondergruppeFormOption {
  id: string;
  name: string;
}

/**
 * Aktive Sondergruppen für die Auswahl im Termin-Formular - AUSSER currentSondergruppeId ist gesetzt
 * (Bearbeiten eines Termins mit bereits zugewiesener, inzwischen deaktivierter Sondergruppe): dann
 * bleibt genau diese eine Gruppe wählbar, auch wenn sie inzwischen deaktiviert wurde, sonst könnte
 * das Bearbeitungsformular den aktuellen Wert nicht mehr anzeigen (gleiches Muster wie
 * getManageableDroneGroupOptions in lib/calendar/drone-group-options.ts).
 */
export async function getSondergruppeOptions(
  currentSondergruppeId?: string | null,
): Promise<SondergruppeFormOption[]> {
  const groups = await prisma.sondergruppe.findMany({
    where: currentSondergruppeId ? { OR: [{ isActive: true }, { id: currentSondergruppeId }] } : { isActive: true },
    select: { id: true, name: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return groups.map((g) => ({ id: g.id, name: g.isActive ? g.name : `${g.name} (deaktiviert)` }));
}
```

- [ ] **Step 2: `event-form.tsx` — new props and imports**

Find:

```tsx
interface DroneGroupOption {
  id: string;
  name: string;
}

interface EventFormProps {
  organizations: OrganizationOption[];
  canSectionWide: boolean;
  droneGroupOptions: DroneGroupOption[];
  defaultValues?: Partial<EventInput>;
  action: (prevState: EventFormState, formData: FormData) => Promise<EventFormState>;
  submitLabel: string;
}

export function EventForm({
  organizations,
  canSectionWide,
  droneGroupOptions,
  defaultValues,
  action,
  submitLabel,
}: EventFormProps) {
```

Replace with:

```tsx
interface DroneGroupOption {
  id: string;
  name: string;
}

interface SondergruppeOption {
  id: string;
  name: string;
}

interface EventFormProps {
  organizations: OrganizationOption[];
  canSectionWide: boolean;
  canDistrictWide: boolean;
  droneGroupOptions: DroneGroupOption[];
  sondergruppeOptions: SondergruppeOption[];
  defaultValues?: Partial<EventInput>;
  action: (prevState: EventFormState, formData: FormData) => Promise<EventFormState>;
  submitLabel: string;
}

export function EventForm({
  organizations,
  canSectionWide,
  canDistrictWide,
  droneGroupOptions,
  sondergruppeOptions,
  defaultValues,
  action,
  submitLabel,
}: EventFormProps) {
```

- [ ] **Step 3: Add the two new fields to `useForm`'s `defaultValues`**

Find:

```tsx
    defaultValues: {
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      allDay: false,
      organizationId: organizations[0]?.id ?? '',
      isSectionWide: false,
      // Ein Nutzer ohne jede eigene Feuerwehr-Admin-Mitgliedschaft (reiner Bezirksadmin/Bezirks-
      // Drohnenadmin/Admin Drohnengruppe) hat organizations=[] - für den ist "Allgemein" gar keine
      // sinnvolle Standardauswahl (leeres Organisation-<select>), "Drohnengruppe" dagegen schon.
      category: organizations.length === 0 && droneGroupOptions.length > 0 ? 'DROHNENGRUPPE' : 'ALLGEMEIN',
      droneGroupId: droneGroupOptions[0]?.id ?? null,
      ...defaultValues,
    },
```

Replace with:

```tsx
    defaultValues: {
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      allDay: false,
      organizationId: organizations[0]?.id ?? '',
      isSectionWide: false,
      isDistrictWide: false,
      // Ein Nutzer ohne jede eigene Feuerwehr-Admin-Mitgliedschaft (reiner Bezirksadmin/Bezirks-
      // Drohnenadmin/Admin Drohnengruppe) hat organizations=[] - für den ist "Allgemein" gar keine
      // sinnvolle Standardauswahl (leeres Organisation-<select>), "Drohnengruppe" dagegen schon.
      category: organizations.length === 0 && droneGroupOptions.length > 0 ? 'DROHNENGRUPPE' : 'ALLGEMEIN',
      droneGroupId: droneGroupOptions[0]?.id ?? null,
      sondergruppeId: null,
      ...defaultValues,
    },
```

- [ ] **Step 4: Add the Geltungsbereich watch/handler right after `showSectionWideOption`**

Find:

```tsx
  const selectedOrgId = watch('organizationId');
  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);
  const showSectionWideOption = canSectionWide && selectedOrg?.type === 'ABSCHNITTSKOMMANDO';
  const category = watch('category');
  const startsAt = watch('startsAt');
```

Replace with:

```tsx
  const selectedOrgId = watch('organizationId');
  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);
  const showSectionWideOption = canSectionWide && selectedOrg?.type === 'ABSCHNITTSKOMMANDO';
  const category = watch('category');
  const startsAt = watch('startsAt');
  const isSectionWideValue = watch('isSectionWide');
  const isDistrictWideValue = watch('isDistrictWide');
  const geltungsbereich: 'FEUERWEHR' | 'ABSCHNITT' | 'BEZIRK' = isDistrictWideValue
    ? 'BEZIRK'
    : isSectionWideValue
      ? 'ABSCHNITT'
      : 'FEUERWEHR';

  // 3-stufige Geltungsbereichs-Auswahl (Eigene Feuerwehr/Abschnitt-weit/Bezirk-weit) für
  // ALLGEMEIN-Termine - siehe docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md.
  // isSectionWide/isDistrictWide bleiben zwei unabhängige Zod-Felder statt eines gemeinsamen Enums
  // (additive Erweiterung neben dem bestehenden Feld), diese Funktion hält sie im UI synchron.
  function handleGeltungsbereichChange(value: 'FEUERWEHR' | 'ABSCHNITT' | 'BEZIRK') {
    setValue('isSectionWide', value === 'ABSCHNITT');
    setValue('isDistrictWide', value === 'BEZIRK');
  }
```

- [ ] **Step 5: Update `onSubmit`'s FormData construction**

Find:

```tsx
    formData.set('organizationId', values.organizationId);
    if (values.isSectionWide) formData.set('isSectionWide', 'on');
    formData.set('category', values.category);
    if (values.droneGroupId) formData.set('droneGroupId', values.droneGroupId);
```

Replace with:

```tsx
    formData.set('organizationId', values.organizationId);
    if (values.isSectionWide) formData.set('isSectionWide', 'on');
    if (values.isDistrictWide) formData.set('isDistrictWide', 'on');
    formData.set('category', values.category);
    if (values.droneGroupId) formData.set('droneGroupId', values.droneGroupId);
    if (values.sondergruppeId) formData.set('sondergruppeId', values.sondergruppeId);
```

- [ ] **Step 6: Replace the single checkbox with the 3-way radio group, and add the Sondergruppe select**

Find:

```tsx
      {showSectionWideOption && !isDroneCategory && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" {...register('isSectionWide')} />
          Abschnitt-weiter Termin (in allen Feuerwehr-Kalendern sichtbar)
        </label>
      )}

      {showCategorySelect && (
```

Replace with:

```tsx
      {showSectionWideOption && !isDroneCategory && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-neutral-700">Geltungsbereich</label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="radio"
              name="geltungsbereich"
              checked={geltungsbereich === 'FEUERWEHR'}
              onChange={() => handleGeltungsbereichChange('FEUERWEHR')}
            />
            Eigene Feuerwehr
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="radio"
              name="geltungsbereich"
              checked={geltungsbereich === 'ABSCHNITT'}
              onChange={() => handleGeltungsbereichChange('ABSCHNITT')}
            />
            Abschnitt-weit (in allen Feuerwehr-Kalendern des Abschnitts sichtbar)
          </label>
          {canDistrictWide && (
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="radio"
                name="geltungsbereich"
                checked={geltungsbereich === 'BEZIRK'}
                onChange={() => handleGeltungsbereichChange('BEZIRK')}
              />
              Bezirk-weit (im gesamten Bezirk sichtbar)
            </label>
          )}
        </div>
      )}

      {!isDroneCategory && sondergruppeOptions.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Sondergruppe (optional)</label>
          <select {...register('sondergruppeId')} className="rounded border border-neutral-300 px-3 py-2">
            <option value="">Keine</option>
            {sondergruppeOptions.map((gruppe) => (
              <option key={gruppe.id} value={gruppe.id}>
                {gruppe.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showCategorySelect && (
```

- [ ] **Step 7: `kalender/neu/page.tsx` — thread the two new props**

Find:

```tsx
import { canCreateAnySectionWideEvent, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { EventForm } from '@/components/calendar/event-form';
import { createEvent } from '../actions';
```

Replace with:

```tsx
import { canCreateAnySectionWideEvent, canCreateBezirksWideEvent, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { getSondergruppeOptions } from '@/lib/calendar/sondergruppe-options';
import { EventForm } from '@/components/calendar/event-form';
import { createEvent } from '../actions';
```

Find:

```tsx
  const { sectionWide } = await searchParams;
  const canSectionWide = canCreateAnySectionWideEvent(user);

  const [organizations, droneGroupOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds }, isActive: true },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neuer Termin</h1>
      <EventForm
        organizations={organizations}
        canSectionWide={canSectionWide}
        droneGroupOptions={droneGroupOptions}
        action={createEvent}
        submitLabel="Termin anlegen"
        defaultValues={canSectionWide && sectionWide === '1' ? { isSectionWide: true } : undefined}
      />
    </div>
  );
```

Replace with:

```tsx
  const { sectionWide } = await searchParams;
  const canSectionWide = canCreateAnySectionWideEvent(user);
  const canDistrictWide = canCreateBezirksWideEvent(user);

  const [organizations, droneGroupOptions, sondergruppeOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds }, isActive: true },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user),
    getSondergruppeOptions(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neuer Termin</h1>
      <EventForm
        organizations={organizations}
        canSectionWide={canSectionWide}
        canDistrictWide={canDistrictWide}
        droneGroupOptions={droneGroupOptions}
        sondergruppeOptions={sondergruppeOptions}
        action={createEvent}
        submitLabel="Termin anlegen"
        defaultValues={canSectionWide && sectionWide === '1' ? { isSectionWide: true } : undefined}
      />
    </div>
  );
```

- [ ] **Step 8: `kalender/[eventId]/bearbeiten/page.tsx` — thread the two new props**

Find:

```tsx
import { canCreateAnySectionWideEvent, canManageEvent } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
import { EventForm } from '@/components/calendar/event-form';
```

Replace with:

```tsx
import { canCreateAnySectionWideEvent, canCreateBezirksWideEvent, canManageEvent } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { getSondergruppeOptions } from '@/lib/calendar/sondergruppe-options';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
import { EventForm } from '@/components/calendar/event-form';
```

Find:

```tsx
  const [organizations, droneGroupOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { OR: [{ id: { in: user.feuerwehrAdminOrgIds }, isActive: true }, { id: event.organizationId }] },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user, event.category === 'DROHNENGRUPPE' ? event.droneGroupId : undefined),
  ]);
```

Replace with:

```tsx
  const [organizations, droneGroupOptions, sondergruppeOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { OR: [{ id: { in: user.feuerwehrAdminOrgIds }, isActive: true }, { id: event.organizationId }] },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user, event.category === 'DROHNENGRUPPE' ? event.droneGroupId : undefined),
    getSondergruppeOptions(event.sondergruppeId),
  ]);
```

Find:

```tsx
      <EventForm
        organizations={organizations}
        canSectionWide={canCreateAnySectionWideEvent(user)}
        droneGroupOptions={droneGroupOptions}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        defaultValues={{
          title: event.title,
          description: event.description ?? '',
          location: event.location ?? '',
          startsAt: toDatetimeLocalValue(event.startsAt),
          endsAt: toDatetimeLocalValue(event.endsAt),
          allDay: event.allDay,
          organizationId: event.organizationId,
          isSectionWide: event.isSectionWide,
          category: event.category,
          droneGroupId: event.droneGroupId ?? (event.category === 'DROHNENGRUPPE' ? BEZIRKSWEIT_DRONE_GROUP_VALUE : null),
        }}
      />
```

Replace with:

```tsx
      <EventForm
        organizations={organizations}
        canSectionWide={canCreateAnySectionWideEvent(user)}
        canDistrictWide={canCreateBezirksWideEvent(user)}
        droneGroupOptions={droneGroupOptions}
        sondergruppeOptions={sondergruppeOptions}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        defaultValues={{
          title: event.title,
          description: event.description ?? '',
          location: event.location ?? '',
          startsAt: toDatetimeLocalValue(event.startsAt),
          endsAt: toDatetimeLocalValue(event.endsAt),
          allDay: event.allDay,
          organizationId: event.organizationId,
          isSectionWide: event.isSectionWide,
          isDistrictWide: event.isDistrictWide,
          category: event.category,
          droneGroupId: event.droneGroupId ?? (event.category === 'DROHNENGRUPPE' ? BEZIRKSWEIT_DRONE_GROUP_VALUE : null),
          sondergruppeId: event.sondergruppeId,
        }}
      />
```

- [ ] **Step 9: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

Then verify manually against the running dev server (`npm run dev`), logged in as a synthetic/real
Abschnittsadmin test account:
1. Open `/kalender/neu`, select an Abschnittskommando as Organisation, confirm the Geltungsbereich radio
   group shows all 3 options including "Bezirk-weit".
2. Select "Bezirk-weit", pick a Sondergruppe, submit, and confirm via a direct DB query that the created
   `Event` row has `isDistrictWide: true`, `isSectionWide: false`, the correct `sondergruppeId`.
3. Log in as a plain Feuerwehr-Admin (no `abschnittAdminOrgIds`, not Bezirksadmin) and confirm the "Bezirk-
   weit" radio option is absent from the rendered form entirely (not just disabled).
4. Open `/kalender/[eventId]/bearbeiten` for the event created in step 2 and confirm the form correctly
   pre-selects "Bezirk-weit" and the chosen Sondergruppe.
5. Edit that same event back to "Eigene Feuerwehr" and confirm the saved row now has both `isSectionWide:
   false` and `isDistrictWide: false`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/calendar/sondergruppe-options.ts src/components/calendar/event-form.tsx src/app/\(app\)/kalender/neu/page.tsx "src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx"
git commit -m "feat: add Bezirk-weit geltungsbereich and Sondergruppe select to the Termin form"
```

---

## Task 7: Sondergruppen-Verwaltung (`/admin/bezirksverwaltung`)

**Files:**
- Create: `src/app/(app)/admin/bezirksverwaltung/add-sondergruppe-form.tsx`
- Create: `src/app/(app)/admin/bezirksverwaltung/rename-sondergruppe-form.tsx`
- Modify: `src/lib/validation/bezirksverwaltung.schema.ts`
- Modify: `src/app/(app)/admin/bezirksverwaltung/actions.ts`
- Modify: `src/app/(app)/admin/bezirksverwaltung/page.tsx`

**Interfaces:**
- Consumes: `canManageSondergruppenBezirksweit(user)` (Task 2), `prisma.sondergruppe` (Task 1),
  `BezirksverwaltungFormState` (already exported from `actions.ts`).
- Produces: `createSondergruppe`, `renameSondergruppe`, `toggleSondergruppeActive` Server Actions;
  `AddSondergruppeForm`, `RenameSondergruppeForm` components. No other task depends on these.

- [ ] **Step 1: Add the two Zod schemas**

In `src/lib/validation/bezirksverwaltung.schema.ts`, at the end of the file (after the existing
`renameDroneGroupSchema`/`RenameDroneGroupInput` export), add:

```ts
export const createSondergruppeSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
});
export type CreateSondergruppeInput = z.infer<typeof createSondergruppeSchema>;

export const renameSondergruppeSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
});
export type RenameSondergruppeInput = z.infer<typeof renameSondergruppeSchema>;
```

- [ ] **Step 2: Add the three Server Actions**

In `src/app/(app)/admin/bezirksverwaltung/actions.ts`, find the top imports:

```ts
import { assertPermission, canManageDrohnengruppenBezirksweit, canManageFeuerwehrenBezirksweit } from '@/lib/auth/permissions';
import {
  createFeuerwehrSchema,
  renameFeuerwehrSchema,
  createDroneGroupSchema,
  renameDroneGroupSchema,
} from '@/lib/validation/bezirksverwaltung.schema';
```

Replace with:

```ts
import {
  assertPermission,
  canManageDrohnengruppenBezirksweit,
  canManageFeuerwehrenBezirksweit,
  canManageSondergruppenBezirksweit,
} from '@/lib/auth/permissions';
import {
  createFeuerwehrSchema,
  renameFeuerwehrSchema,
  createDroneGroupSchema,
  renameDroneGroupSchema,
  createSondergruppeSchema,
  renameSondergruppeSchema,
} from '@/lib/validation/bezirksverwaltung.schema';
```

At the end of the file (after the existing `deleteDroneGroup` function's closing `}`), add:

```ts
export async function createSondergruppe(
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageSondergruppenBezirksweit(user));

  const parsed = createSondergruppeSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.sondergruppe.findUnique({ where: { name: data.name } });
  if (existingName) {
    return { fieldErrors: { name: ['Eine Sondergruppe mit diesem Namen existiert bereits.'] } };
  }

  const maxSortOrder = await prisma.sondergruppe.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxSortOrder._max.sortOrder ?? 0) + 10;

  await prisma.sondergruppe.create({ data: { name: data.name, sortOrder } });
  revalidate();
  return {};
}

export async function renameSondergruppe(
  sondergruppeId: string,
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageSondergruppenBezirksweit(user));

  const existing = await prisma.sondergruppe.findUnique({ where: { id: sondergruppeId } });
  if (!existing) {
    return { error: 'Sondergruppe wurde nicht gefunden.' };
  }

  const parsed = renameSondergruppeSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.sondergruppe.findUnique({ where: { name: data.name } });
  if (existingName && existingName.id !== sondergruppeId) {
    return { fieldErrors: { name: ['Eine Sondergruppe mit diesem Namen existiert bereits.'] } };
  }

  await prisma.sondergruppe.update({ where: { id: sondergruppeId }, data: { name: data.name } });
  revalidate();
  return {};
}

export async function toggleSondergruppeActive(sondergruppeId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageSondergruppenBezirksweit(user));

  const existing = await prisma.sondergruppe.findUniqueOrThrow({ where: { id: sondergruppeId } });
  await prisma.sondergruppe.update({ where: { id: sondergruppeId }, data: { isActive: !existing.isActive } });
  revalidate();
}
```

- [ ] **Step 3: Create `add-sondergruppe-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { createSondergruppe, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function AddSondergruppeForm() {
  const [state, formAction, pending] = useActionState(createSondergruppe, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="sondergruppe-name" className="text-sm font-medium text-neutral-700">
          Name
        </label>
        <input
          id="sondergruppe-name"
          name="name"
          required
          placeholder="Feuerwehrjugend"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {state.fieldErrors?.name && <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>}
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

- [ ] **Step 4: Create `rename-sondergruppe-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { renameSondergruppe, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function RenameSondergruppeForm({
  sondergruppeId,
  currentName,
}: {
  sondergruppeId: string;
  currentName: string;
}) {
  const boundRename = renameSondergruppe.bind(null, sondergruppeId);
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

- [ ] **Step 5: Wire the new section into `page.tsx`**

Find the top imports:

```tsx
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
import { DeleteDroneGroupButton } from './delete-drone-group-button';
import { toggleDroneGroupActive } from './actions';
```

Replace with:

```tsx
import {
  canAccessBezirksverwaltung,
  canManageDrohnengruppenBezirksweit,
  canManageFeuerwehrenBezirksweit,
  canManageSondergruppenBezirksweit,
} from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FeuerwehrenTable, type FeuerwehrRow } from './feuerwehren-table';
import { RenameDroneGroupForm } from './rename-drone-group-form';
import { AddDroneGroupForm } from './add-drone-group-form';
import { DeleteDroneGroupButton } from './delete-drone-group-button';
import { RenameSondergruppeForm } from './rename-sondergruppe-form';
import { AddSondergruppeForm } from './add-sondergruppe-form';
import { toggleDroneGroupActive, toggleSondergruppeActive } from './actions';
```

Find:

```tsx
  const reachableScopes = await getReachableScopes(user);
  const showFeuerwehren = canManageFeuerwehrenBezirksweit(user);
  const showDrohnengruppen = canManageDrohnengruppenBezirksweit(user);
```

Replace with:

```tsx
  const reachableScopes = await getReachableScopes(user);
  const showFeuerwehren = canManageFeuerwehrenBezirksweit(user);
  const showDrohnengruppen = canManageDrohnengruppenBezirksweit(user);
  const showSondergruppen = canManageSondergruppenBezirksweit(user);
```

Find:

```tsx
  const [feuerwehren, droneGroups, bezirksadmins] = await Promise.all([
    showFeuerwehren
      ? prisma.organization.findMany({
          where: { type: 'FEUERWEHR' },
          select: { id: true, name: true, shortName: true, nummer: true, parentId: true, isActive: true, feuerwehrKategorie: true },
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
```

Replace with:

```tsx
  const [feuerwehren, droneGroups, bezirksadmins, sondergruppen] = await Promise.all([
    showFeuerwehren
      ? prisma.organization.findMany({
          where: { type: 'FEUERWEHR' },
          select: { id: true, name: true, shortName: true, nummer: true, parentId: true, isActive: true, feuerwehrKategorie: true },
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
    showSondergruppen
      ? prisma.sondergruppe.findMany({
          select: { id: true, name: true, isActive: true },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
  ]);
```

Find the closing of the Drohnengruppen section (the `</div>` right before the `{showFeuerwehren && (` block
that renders the Bezirksadmins table):

```tsx
          <div className="mt-3">
            <AddDroneGroupForm abschnitte={abschnittOptions} />
          </div>
        </div>
      )}

      {showFeuerwehren && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Bezirksadmins</h2>
```

Replace with:

```tsx
          <div className="mt-3">
            <AddDroneGroupForm abschnitte={abschnittOptions} />
          </div>
        </div>
      )}

      {showSondergruppen && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Sondergruppen</h2>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sondergruppen.map((gruppe) => {
                const boundToggle = toggleSondergruppeActive.bind(null, gruppe.id);
                return (
                  <TableRow key={gruppe.id} className="border-line">
                    <TableCell>
                      <RenameSondergruppeForm sondergruppeId={gruppe.id} currentName={gruppe.name} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={gruppe.isActive ? 'border-transparent bg-success-subtle text-success-text' : 'border-transparent bg-danger-subtle text-danger'}
                      >
                        {gruppe.isActive ? 'Aktiv' : 'Deaktiviert'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={boundToggle}>
                        <button type="submit" className="text-sm text-brand hover:underline">
                          {gruppe.isActive ? 'Deaktivieren' : 'Reaktivieren'}
                        </button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sondergruppen.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-ink-muted">
                    Noch keine Sondergruppe angelegt.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-3">
            <AddSondergruppeForm />
          </div>
        </div>
      )}

      {showFeuerwehren && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Bezirksadmins</h2>
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

Then verify manually against the running dev server, logged in as the seeded Bezirksadmin:
1. Open `/admin/bezirksverwaltung` and confirm a new "Sondergruppen" card appears showing the 3 seeded rows
   (`Feuerwehrjugend`, `Schadstoffgruppe`, `Kommanden`), all "Aktiv".
2. Use "Deaktivieren" on one row, confirm its badge flips to "Deaktiviert", then confirm (via `/kalender/neu`)
   that deactivated Sondergruppe no longer appears in the create-form's Sondergruppe select.
3. Reactivate it and confirm it reappears in both places.
4. Add a new Sondergruppe via the form (e.g. a throwaway test name), confirm it appears in the table with a
   `sortOrder` higher than the 3 seeded ones (query the DB directly to confirm the exact value), then delete
   the test row directly via the database (no delete UI exists for this feature by design) to leave the
   table clean.
5. Log in as a plain Feuerwehr-Admin (not Bezirksadmin) and confirm the "Sondergruppen" card is entirely
   absent from `/admin/bezirksverwaltung`.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/admin/bezirksverwaltung/add-sondergruppe-form.tsx src/app/\(app\)/admin/bezirksverwaltung/rename-sondergruppe-form.tsx src/lib/validation/bezirksverwaltung.schema.ts src/app/\(app\)/admin/bezirksverwaltung/actions.ts src/app/\(app\)/admin/bezirksverwaltung/page.tsx
git commit -m "feat: add Sondergruppen-Verwaltung to Bezirksverwaltung"
```
