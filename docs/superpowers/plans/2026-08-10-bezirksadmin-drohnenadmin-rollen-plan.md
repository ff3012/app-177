# Bezirksadmin-UI + Bezirks-Drohnenadmin-Rolle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `isBezirksAdmin` settable through the Benutzerverwaltung UI (currently migration/seed-only),
and add a new, independent `isBezirksDrohnenAdmin` role that grants district-wide access to all 4
Drohnengruppen without granting full Bezirksadmin rights.

**Architecture:** One additive schema column (`User.isBezirksDrohnenAdmin`), a permission-function
extension (`canManageDroneGroupFor` gains a bypass for it) plus two new grant-check functions, a
three-file nav/gate consistency sweep identical in shape to the one already done for
`droneGroupRole === 'ADMIN'` earlier in this codebase's history, and a `UserFormSheet` UI addition with
one cross-field validation rule (Bezirks-Drohnenadmin forces the assigned group's role to Admin).

**Tech Stack:** Next.js App Router (Server Components/Actions), Prisma/PostgreSQL, TypeScript, react-hook-form + zod, shadcn/ui `Switch`/`SegmentedControl`.

## Global Constraints

- No test suite in this repo — verification is `npx tsc --noEmit`, `npm run build`, and standalone `tsx`
  scripts against the real dev database, exactly as established throughout this codebase's history.
- Never trust client input for a permission-relevant field without a server-side check — this exact class
  of bug (a Feuerwehr-admin self-escalating to Drohnengruppen-Admin of a foreign group) was found and fixed
  in this codebase before; do not reintroduce it for the two new fields here.
- German UI copy, matching the existing convention in every touched file.
- Full design rationale: `docs/superpowers/specs/2026-08-10-bezirksadmin-drohnenadmin-rollen-design.md`.

---

### Task 1: Schema + SessionUser + permissions.ts foundation

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/lib/auth/build-session-user.ts`
- Modify: `src/lib/auth/permissions.ts`

**Interfaces:**
- Produces: `SessionUser.isBezirksDrohnenAdmin: boolean`, `canGrantBezirksAdmin(currentUser): boolean`,
  `canGrantBezirksDrohnenAdmin(currentUser): boolean`. `canManageDroneGroupFor` gains a new bypass branch.

- [ ] **Step 1: Add the schema field**

In `prisma/schema.prisma`, inside `model User { ... }`, add right after the existing `isBezirksAdmin
Boolean @default(false)` line:

```prisma
  // Bezirksweites Recht, alle 4 Drohnengruppen zu sehen/verwalten, unabhängig von einer eigenen
  // Drohnengruppen-Mitgliedschaft - eigenständig von isBezirksAdmin, jemand kann keines, eines oder
  // beide haben. Siehe docs/superpowers/specs/2026-08-10-bezirksadmin-drohnenadmin-rollen-design.md.
  isBezirksDrohnenAdmin Boolean @default(false)
```

Run `npm run db:migrate` (name it `bezirks_drohnenadmin`). This is a plain additive column with a default —
no backfill concern, `false` is correct for every existing row.

- [ ] **Step 2: Update `SessionUser`**

In `src/types/next-auth.d.ts`, add right after the existing `isBezirksAdmin: boolean;` line:

```typescript
  isBezirksDrohnenAdmin: boolean;
```

- [ ] **Step 3: Populate it in `buildSessionUser`**

In `src/lib/auth/build-session-user.ts`, add right after the existing `isBezirksAdmin: user.isBezirksAdmin,`
line inside the returned object:

```typescript
    isBezirksDrohnenAdmin: user.isBezirksDrohnenAdmin,
```

- [ ] **Step 4: Extend `canManageDroneGroupFor` and add the two grant-check functions**

In `src/lib/auth/permissions.ts`, replace the current `canManageDroneGroupFor`:

```typescript
export function canManageDroneGroupFor(
  user: SessionUser,
  droneGroup: { id: string; organizationId: string },
): boolean {
  return (
    isBezirksAdmin(user) ||
    canManageAbschnittFor(user, droneGroup.organizationId) ||
    (user.droneGroupRole === 'ADMIN' && user.droneGroupId === droneGroup.id)
  );
}
```

with:

```typescript
export function canManageDroneGroupFor(
  user: SessionUser,
  droneGroup: { id: string; organizationId: string },
): boolean {
  return (
    isBezirksAdmin(user) ||
    user.isBezirksDrohnenAdmin ||
    canManageAbschnittFor(user, droneGroup.organizationId) ||
    (user.droneGroupRole === 'ADMIN' && user.droneGroupId === droneGroup.id)
  );
}
```

Add these two new functions right after `canManageDroneGroupFor`:

```typescript
/** Wer darf isBezirksAdmin bei einem ANDEREN Benutzer setzen/entziehen - nur bestehende Bezirksadmins. */
export function canGrantBezirksAdmin(currentUser: SessionUser): boolean {
  return isBezirksAdmin(currentUser);
}

/** Wer darf isBezirksDrohnenAdmin bei einem ANDEREN Benutzer setzen/entziehen - ein Bezirksadmin ODER
 * ein bestehender Bezirks-Drohnenadmin (bewusst weiter gefasst als canGrantBezirksAdmin, siehe Design-Spec). */
export function canGrantBezirksDrohnenAdmin(currentUser: SessionUser): boolean {
  return isBezirksAdmin(currentUser) || currentUser.isBezirksDrohnenAdmin;
}
```

- [ ] **Step 5: Verify with `tsc` and a live-data script**

```bash
npx tsc --noEmit
```

Expected: errors in every file that constructs a `SessionUser`-shaped object without the new field (e.g.
any test/verification script from a prior session, if one still exists — there shouldn't be any committed
ones) — but no errors in real application code, since `build-session-user.ts` is the only real constructor.
If you see unexpected errors elsewhere, investigate before continuing.

Create `scripts-tmp-verify-bezirksdrohnenadmin.ts`:

```typescript
import { canManageDroneGroupFor, canGrantBezirksAdmin, canGrantBezirksDrohnenAdmin } from './src/lib/auth/permissions';
import type { SessionUser } from './src/types/next-auth';

function fakeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'u1', email: 'a@b.c', name: 'Test User',
    homeOrganizationId: 'org1', homeOrganizationType: 'FEUERWEHR', homeAbschnittOrganizationId: 'abschnitt1',
    feuerwehrAdminOrgIds: [], abschnittAdminOrgIds: [], isBezirksAdmin: false, isBezirksDrohnenAdmin: false,
    isAbschnittskommandoMitglied: false, isDrohnengruppeMember: false, droneGroupId: null, droneGroupRole: null,
    ...overrides,
  };
}

const bezirksDrohnenAdmin = fakeUser({ isBezirksDrohnenAdmin: true });
const plainMember = fakeUser({});
const bezirksAdmin = fakeUser({ isBezirksAdmin: true });

console.log('Bezirks-Drohnenadmin manages ANY group, no membership needed:', canManageDroneGroupFor(bezirksDrohnenAdmin, { id: 'groupX', organizationId: 'abschnittY' }) === true);
console.log('Plain member does not:', canManageDroneGroupFor(plainMember, { id: 'groupX', organizationId: 'abschnittY' }) === false);

console.log('Only Bezirksadmin can grant Bezirksadmin:', canGrantBezirksAdmin(bezirksAdmin) === true && canGrantBezirksAdmin(bezirksDrohnenAdmin) === false && canGrantBezirksAdmin(plainMember) === false);
console.log('Bezirksadmin OR Bezirks-Drohnenadmin can grant Bezirks-Drohnenadmin:', canGrantBezirksDrohnenAdmin(bezirksAdmin) === true && canGrantBezirksDrohnenAdmin(bezirksDrohnenAdmin) === true && canGrantBezirksDrohnenAdmin(plainMember) === false);
```

Run: `npx tsx scripts-tmp-verify-bezirksdrohnenadmin.ts` — every line must print `true`. Delete the script
afterward.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/types/next-auth.d.ts src/lib/auth/build-session-user.ts src/lib/auth/permissions.ts
git commit -m "Auth: isBezirksDrohnenAdmin-Recht ergaenzt"
```

---

### Task 2: Nav/layout consistency sweep

**Files:**
- Modify: `src/lib/admin/nav-items.ts`
- Modify: `src/app/(app)/admin/layout.tsx`
- Modify: `src/lib/nav-items.ts`

**Interfaces:**
- Consumes: `SessionUser.isBezirksDrohnenAdmin` from Task 1.

This is the exact same 3-file consistency sweep this codebase already did once for
`droneGroupRole === 'ADMIN'` (a pure Drohnengruppen-Admin) — `isBezirksDrohnenAdmin` needs the identical
treatment at the identical 3 checkpoints, or a Bezirks-Drohnenadmin would have the underlying permission but
no way to discover or reach the page that uses it.

- [ ] **Step 1: `lib/admin/nav-items.ts` — `/admin/drohnen` visibility**

Find:

```typescript
  if (isBezirksAdmin(user) || user.abschnittAdminOrgIds.length > 0 || user.droneGroupRole === 'ADMIN') {
    items.push({ href: '/admin/drohnen', label: 'Drohnengruppe' });
  }
```

Replace with:

```typescript
  if (
    isBezirksAdmin(user) ||
    user.isBezirksDrohnenAdmin ||
    user.abschnittAdminOrgIds.length > 0 ||
    user.droneGroupRole === 'ADMIN'
  ) {
    items.push({ href: '/admin/drohnen', label: 'Drohnengruppe' });
  }
```

- [ ] **Step 2: `admin/layout.tsx` — the page-render gate**

Find:

```typescript
  if (!canAccessHeimatfeuerwehrAdmin(user) && user.droneGroupRole !== 'ADMIN') {
    notFound();
  }
```

Replace with:

```typescript
  if (!canAccessHeimatfeuerwehrAdmin(user) && user.droneGroupRole !== 'ADMIN' && !user.isBezirksDrohnenAdmin) {
    notFound();
  }
```

Add one sentence to the doc comment above this function (the one already documenting the
`droneGroupRole === 'ADMIN'` widening) noting that `isBezirksDrohnenAdmin` gets the identical treatment for
the identical reason — copy the existing paragraph's structure rather than writing a new one from scratch.

- [ ] **Step 3: `lib/nav-items.ts` — `getVerwaltungNavItem`'s routing**

Find:

```typescript
export function getVerwaltungNavItem(user: SessionUser): NavItem | null {
  if (isBezirksAdmin(user)) {
    return { href: '/admin/benutzer', label: 'Verwaltung' };
  }
  if (canAccessHeimatfeuerwehrAdmin(user)) {
    return { href: '/admin/heimatfeuerwehr', label: 'Verwaltung' };
  }
  if (isDroneGroupAdmin(user)) {
    return { href: '/admin/drohnen', label: 'Verwaltung' };
  }
  return null;
}
```

Replace the third branch's condition:

```typescript
export function getVerwaltungNavItem(user: SessionUser): NavItem | null {
  if (isBezirksAdmin(user)) {
    return { href: '/admin/benutzer', label: 'Verwaltung' };
  }
  if (canAccessHeimatfeuerwehrAdmin(user)) {
    return { href: '/admin/heimatfeuerwehr', label: 'Verwaltung' };
  }
  if (isDroneGroupAdmin(user) || user.isBezirksDrohnenAdmin) {
    return { href: '/admin/drohnen', label: 'Verwaltung' };
  }
  return null;
}
```

- [ ] **Step 4: Verify with `tsc` and a live-data script**

```bash
npx tsc --noEmit
```

Expected: clean.

Create `scripts-tmp-verify-nav-sweep.ts`:

```typescript
import { getAdminNavItems } from './src/lib/admin/nav-items';
import { getVerwaltungNavItem } from './src/lib/nav-items';
import type { SessionUser } from './src/types/next-auth';

function fakeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'u1', email: 'a@b.c', name: 'Test User',
    homeOrganizationId: 'org1', homeOrganizationType: 'FEUERWEHR', homeAbschnittOrganizationId: 'abschnitt1',
    feuerwehrAdminOrgIds: [], abschnittAdminOrgIds: [], isBezirksAdmin: false, isBezirksDrohnenAdmin: false,
    isAbschnittskommandoMitglied: false, isDrohnengruppeMember: false, droneGroupId: null, droneGroupRole: null,
    ...overrides,
  };
}

const pureBezirksDrohnenAdmin = fakeUser({ isBezirksDrohnenAdmin: true });

console.log('Sees /admin/drohnen in admin nav:', getAdminNavItems(pureBezirksDrohnenAdmin).some((i) => i.href === '/admin/drohnen'));
console.log('Does NOT see /admin/benutzer or /admin/heimatfeuerwehr:', !getAdminNavItems(pureBezirksDrohnenAdmin).some((i) => i.href === '/admin/benutzer' || i.href === '/admin/heimatfeuerwehr'));
console.log('Top-level Verwaltung link routes to /admin/drohnen:', getVerwaltungNavItem(pureBezirksDrohnenAdmin)?.href === '/admin/drohnen');
```

Run: `npx tsx scripts-tmp-verify-nav-sweep.ts` — every line must print `true`. Delete the script afterward.

Additionally, read the current `admin/layout.tsx` gate change through by hand for the two OTHER admin pages
that already have their own explicit `isBezirksAdmin`-only gate (`admin/email/page.tsx`,
`admin/status/page.tsx`) and confirm they are untouched by this task — a pure Bezirks-Drohnenadmin must
still be rejected by those two pages' own stricter checks, exactly like a pure `droneGroupRole === 'ADMIN'`
user already is. Do not weaken those two pages' own gates.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/nav-items.ts src/app/\(app\)/admin/layout.tsx src/lib/nav-items.ts
git commit -m "Nav: Bezirks-Drohnenadmin erreicht /admin/drohnen ueber Sidebar und Verwaltungs-Link"
```

---

### Task 3: Validation schema + Server Actions (write path)

**Files:**
- Modify: `src/lib/validation/user.schema.ts`
- Modify: `src/app/(app)/admin/benutzer/actions.ts`

**Interfaces:**
- Consumes: `canGrantBezirksAdmin`, `canGrantBezirksDrohnenAdmin` from Task 1.
- Produces: `userSchema` gains `isBezirksAdmin`/`isBezirksDrohnenAdmin` fields plus a cross-field refine.

- [ ] **Step 1: `user.schema.ts` — add the two fields and the refine**

Replace the current `userSchema` definition:

```typescript
export const userSchema = z.object({
  firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
  lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
  email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
  stbNr: z.string().trim().max(50).optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || E164_PHONE_REGEX.test(value), {
      message: 'Telefonnummer muss im E.164-Format sein (z. B. +436601234567).',
    })
    .optional()
    .or(z.literal('')),
  isActive: z.boolean(),
  istAtemschutzgeraeteTraeger: z.boolean(),
  dienstgradId: z.string().optional().or(z.literal('')),
  homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
  adminOrgIds: z.array(z.string()),
  droneRole: z.enum(DRONE_ROLE_OPTIONS),
  droneGroupId: z.string().nullable(),
  sendWelcomeEmail: z.boolean(),
});
```

with:

```typescript
export const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
    lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
    email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
    stbNr: z.string().trim().max(50).optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || E164_PHONE_REGEX.test(value), {
        message: 'Telefonnummer muss im E.164-Format sein (z. B. +436601234567).',
      })
      .optional()
      .or(z.literal('')),
    isActive: z.boolean(),
    istAtemschutzgeraeteTraeger: z.boolean(),
    dienstgradId: z.string().optional().or(z.literal('')),
    homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
    adminOrgIds: z.array(z.string()),
    droneRole: z.enum(DRONE_ROLE_OPTIONS),
    droneGroupId: z.string().nullable(),
    isBezirksAdmin: z.boolean(),
    isBezirksDrohnenAdmin: z.boolean(),
    sendWelcomeEmail: z.boolean(),
  })
  .refine((data) => !data.isBezirksDrohnenAdmin || data.droneRole === 'ADMIN', {
    message: 'Bezirks-Drohnenadmin erfordert die Rolle "Admin" in der zugeordneten Gruppe.',
    path: ['droneRole'],
  });
```

Note: `userSchema` becomes a `ZodEffects` wrapper once `.refine` is added (it no longer has a plain
`.shape` property) — grep for `userSchema.shape` or similar direct property access anywhere in the
codebase before this change; if anything relies on it, it needs to move to referencing the inner
`z.object(...)` before the `.refine()` call instead. (This codebase's other `.refine()`-using schemas,
e.g. `eventSchema`, already establish this exact pattern — check how their call sites handle it, if at
all, for precedent.)

Update `parseUserFormData` — add right after the existing `droneGroupId: (formData.get('droneGroupId') as
string) || null,` line:

```typescript
    isBezirksAdmin: formData.get('isBezirksAdmin') === 'on',
    isBezirksDrohnenAdmin: formData.get('isBezirksDrohnenAdmin') === 'on',
```

- [ ] **Step 2: `admin/benutzer/actions.ts` — grant checks in `createUser`/`updateUser`**

Add the import: extend the existing `import { assertPermission, canManageDroneGroupFor, canManageUsersFor,
filterRemovableAdminOrgIds } from '@/lib/auth/permissions';` to also import `canGrantBezirksAdmin,
canGrantBezirksDrohnenAdmin`.

In `createUser`, add right after the existing `assertPermission(canGrantAdminFor(currentUser,
data.adminOrgIds));` line:

```typescript
  if (data.isBezirksAdmin) {
    assertPermission(canGrantBezirksAdmin(currentUser));
  }
  if (data.isBezirksDrohnenAdmin) {
    assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
  }
```

Add `isBezirksAdmin: data.isBezirksAdmin, isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,` to the
`prisma.user.create({ data: { ... } })` object, right after the existing `homeOrganizationId:
data.homeOrganizationId,` line.

In `updateUser`, add right after the existing `assertPermission(canGrantAdminFor(currentUser,
data.adminOrgIds));` line (this is AFTER `targetUser` has already been loaded earlier in the function, so
it's available here):

```typescript
  if (data.isBezirksAdmin !== targetUser.isBezirksAdmin) {
    assertPermission(canGrantBezirksAdmin(currentUser));
  }
  if (data.isBezirksDrohnenAdmin !== targetUser.isBezirksDrohnenAdmin) {
    assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
  }
```

Add `isBezirksAdmin: data.isBezirksAdmin, isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,` to the
`prisma.user.update({ data: { ... } })` object, right after the existing `homeOrganizationId:
data.homeOrganizationId,` line.

- [ ] **Step 3: Verify with `tsc` and a live-data script**

```bash
npx tsc --noEmit
```

Expected: clean.

Create `scripts-tmp-verify-grant-checks.ts`:

```typescript
import { canGrantBezirksAdmin, canGrantBezirksDrohnenAdmin } from './src/lib/auth/permissions';
import { userSchema } from './src/lib/validation/user.schema';

// Refine check: Bezirks-Drohnenadmin=true requires droneRole=ADMIN
const invalid = userSchema.safeParse({
  firstName: 'A', lastName: 'B', email: 'a@b.c', stbNr: '', phone: '',
  isActive: true, istAtemschutzgeraeteTraeger: false, dienstgradId: '',
  homeOrganizationId: 'org1', adminOrgIds: [], droneRole: 'PILOT', droneGroupId: 'group1',
  isBezirksAdmin: false, isBezirksDrohnenAdmin: true, sendWelcomeEmail: true,
});
console.log('Rejects Bezirks-Drohnenadmin with droneRole != ADMIN:', invalid.success === false);

const valid = userSchema.safeParse({
  firstName: 'A', lastName: 'B', email: 'a@b.c', stbNr: '', phone: '',
  isActive: true, istAtemschutzgeraeteTraeger: false, dienstgradId: '',
  homeOrganizationId: 'org1', adminOrgIds: [], droneRole: 'ADMIN', droneGroupId: 'group1',
  isBezirksAdmin: false, isBezirksDrohnenAdmin: true, sendWelcomeEmail: true,
});
console.log('Accepts Bezirks-Drohnenadmin with droneRole = ADMIN:', valid.success === true);

const withoutFlag = userSchema.safeParse({
  firstName: 'A', lastName: 'B', email: 'a@b.c', stbNr: '', phone: '',
  isActive: true, istAtemschutzgeraeteTraeger: false, dienstgradId: '',
  homeOrganizationId: 'org1', adminOrgIds: [], droneRole: 'NONE', droneGroupId: null,
  isBezirksAdmin: false, isBezirksDrohnenAdmin: false, sendWelcomeEmail: true,
});
console.log('Accepts plain user with both flags false and droneRole NONE:', withoutFlag.success === true);
```

Run: `npx tsx scripts-tmp-verify-grant-checks.ts` — all 3 lines must print `true`. Delete the script
afterward.

Also write a second script exercising the actual `createUser`/`updateUser` authorization path against the
real dev database: create a throwaway Feuerwehr-admin `SessionUser`-shaped object (no `isBezirksAdmin`, no
`isBezirksDrohnenAdmin`) and confirm that submitting `isBezirksAdmin: true` or `isBezirksDrohnenAdmin: true`
via a direct call to the underlying logic throws `ForbiddenError` — you cannot call the Server Actions
directly outside a request context easily, so instead directly test `canGrantBezirksAdmin`/
`canGrantBezirksDrohnenAdmin` against that fake user (already covered by Task 1's script) AND read through
`createUser`/`updateUser`'s new code once more by hand to confirm the `assertPermission` calls are
correctly placed before the `prisma.user.create`/`update` call, not after.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation/user.schema.ts src/app/\(app\)/admin/benutzer/actions.ts
git commit -m "Benutzerverwaltung: Vergabe-Pruefung fuer Bezirksadmin/Bezirks-Drohnenadmin"
```

---

### Task 4: UserFormSheet UI + prop threading

**Files:**
- Modify: `src/components/admin/user-form-sheet.tsx`
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx`
- Modify: `src/app/(app)/admin/benutzer/page.tsx`

**Interfaces:**
- Consumes: `userSchema`'s new fields from Task 3.
- Produces: `UserSheetTarget` gains `isBezirksAdmin`/`isBezirksDrohnenAdmin`; `UserFormSheetProps` gains
  `viewerIsBezirksAdmin: boolean` and `viewerIsBezirksDrohnenAdmin: boolean`.

- [ ] **Step 1: `page.tsx` — fetch and pass the viewer's own flags, add fields to the row mapping**

`admin/benutzer/page.tsx` already computes `fullAdmin = isBezirksAdmin(currentUser)`. Add right after that
line:

```typescript
  const viewerIsBezirksDrohnenAdmin = currentUser.isBezirksDrohnenAdmin;
```

In the `prisma.user.findMany` query's `select`/no-`select` shape, no change is needed (it already fetches
every scalar column via a select-less `findMany` with only relation `include`s) — `isBezirksAdmin`/
`isBezirksDrohnenAdmin` are already present on each returned `u`.

In the `rows: UserRow[] = users.map((u) => ({ ... }))` object literal, add right after the existing
`dienstgrad: u.dienstgrad?.kurzform ?? '',` line:

```typescript
      isBezirksAdmin: u.isBezirksAdmin,
      isBezirksDrohnenAdmin: u.isBezirksDrohnenAdmin,
```

In the final `<UserManagementSection ... />` call, add two new props right after the existing
`isFullAdmin={fullAdmin}` line:

```typescript
      viewerIsBezirksAdmin={fullAdmin}
      viewerIsBezirksDrohnenAdmin={viewerIsBezirksDrohnenAdmin}
```

- [ ] **Step 2: `user-management-section.tsx` — extend `UserRow`, accept the new props, thread to `UserFormSheet`**

Add to the `UserRow` interface, right after the existing `dienstgrad: string;` line:

```typescript
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
```

Add to the component's destructured props (find the parameter list that currently includes `isFullAdmin,`)
two new entries: `viewerIsBezirksAdmin,` and `viewerIsBezirksDrohnenAdmin,` — and to the accompanying type
annotation object (which has `isFullAdmin: boolean;`), add `viewerIsBezirksAdmin: boolean;` and
`viewerIsBezirksDrohnenAdmin: boolean;`.

In the `sheetTarget` object construction, add right after the existing `dienstgradId:
sheetTargetRow.dienstgradId,` line:

```typescript
        isBezirksAdmin: sheetTargetRow.isBezirksAdmin,
        isBezirksDrohnenAdmin: sheetTargetRow.isBezirksDrohnenAdmin,
```

In the `<UserFormSheet ... />` render call, add two new props right after the existing `droneGroups={droneGroups}` line:

```typescript
        viewerIsBezirksAdmin={viewerIsBezirksAdmin}
        viewerIsBezirksDrohnenAdmin={viewerIsBezirksDrohnenAdmin}
```

- [ ] **Step 3: `user-form-sheet.tsx` — the two toggles**

Add to `UserSheetTarget`, right after the existing `droneGroupId: string | null;` line:

```typescript
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
```

Add to `UserFormSheetProps`, right after the existing `droneGroups: { id: string; name: string }[];` line:

```typescript
  viewerIsBezirksAdmin: boolean;
  viewerIsBezirksDrohnenAdmin: boolean;
```

Destructure the two new props in the component's parameter list (the line currently reading `export
function UserFormSheet({ open, onOpenChange, mode, organizations, dienstgrade, droneGroups, target, onSaved
}: UserFormSheetProps) {`) — add `viewerIsBezirksAdmin, viewerIsBezirksDrohnenAdmin,` to the destructured
list.

In `buildDefaultValues`, add right after the existing `droneGroupId: target?.droneGroupId ?? null,` line:

```typescript
    isBezirksAdmin: target?.isBezirksAdmin ?? false,
    isBezirksDrohnenAdmin: target?.isBezirksDrohnenAdmin ?? false,
```

Add a new watched field alongside the existing `const droneRole = watch('droneRole');` line:

```typescript
  const isBezirksDrohnenAdmin = watch('isBezirksDrohnenAdmin');
```

Add a `useEffect` right after the existing `useEffect` blocks (after the cleanup-timeout one), forcing
`droneRole` to `'ADMIN'` whenever `isBezirksDrohnenAdmin` becomes true — this needs `setValue` from
`useForm`, so add `setValue` to the existing destructured `const { register, control, handleSubmit, watch,
reset, formState: { errors, isDirty } } = useForm<UserInput>({...});` call (add `setValue,` to that list):

```typescript
  useEffect(() => {
    if (isBezirksDrohnenAdmin) {
      setValue('droneRole', 'ADMIN', { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBezirksDrohnenAdmin]);
```

In `onSubmit`'s `FormData` building, add right after the existing `if (values.droneGroupId)
formData.set('droneGroupId', values.droneGroupId);` line:

```typescript
    if (values.isBezirksAdmin) formData.set('isBezirksAdmin', 'on');
    if (values.isBezirksDrohnenAdmin) formData.set('isBezirksDrohnenAdmin', 'on');
```

**Bezirksadmin toggle — new "Bezirksweite Rechte" section.** Add a new `<section>` right after the closing
`</section>` of the existing "Zuordnung" section (before "Funktionen und Ausbildung"'s `<section>`), shown
only when the viewer has at least one of the two rights:

```tsx
                {(viewerIsBezirksAdmin || viewerIsBezirksDrohnenAdmin) && (
                  <section>
                    <SectionLabel>Bezirksweite Rechte</SectionLabel>
                    <div className="rounded-lg border border-line">
                      <div className="flex items-center justify-between gap-3.5 px-3.5 py-3">
                        <div>
                          <div className="text-[15px] font-medium text-ink">Bezirksadmin</div>
                          <div className="mt-0.5 text-[13px] text-ink-muted">Voller Zugriff auf Benutzerverwaltung, E-Mail, Status, News</div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={viewerIsBezirksAdmin ? -1 : 0} className="inline-block">
                              <Controller
                                control={control}
                                name="isBezirksAdmin"
                                render={({ field }) => (
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    disabled={!viewerIsBezirksAdmin}
                                  />
                                )}
                              />
                            </span>
                          </TooltipTrigger>
                          {!viewerIsBezirksAdmin && <TooltipContent>Nur Bezirksadmins können diesen Status vergeben</TooltipContent>}
                        </Tooltip>
                      </div>
                    </div>
                  </section>
                )}
```

**Bezirks-Drohnenadmin toggle — inside "Funktionen und Ausbildung".** Replace the existing block:

```tsx
                    <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                      <div className="text-[15px] font-medium text-ink">Drohnengruppe</div>
                      <Controller
                        control={control}
                        name="droneRole"
                        render={({ field }) => (
                          <SegmentedControl
                            aria-label="Drohnengruppe"
                            value={field.value}
                            onValueChange={field.onChange}
                            options={DRONE_ROLE_OPTIONS.map((option) => ({ value: option, label: DRONE_ROLE_LABELS[option] }))}
                          />
                        )}
                      />
                    </div>
                    {droneRole !== 'NONE' && (
```

with:

```tsx
                    <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                      <div className="text-[15px] font-medium text-ink">Drohnengruppe</div>
                      <Controller
                        control={control}
                        name="droneRole"
                        render={({ field }) => (
                          <SegmentedControl
                            aria-label="Drohnengruppe"
                            value={field.value}
                            onValueChange={field.onChange}
                            options={DRONE_ROLE_OPTIONS.map((option) => ({
                              value: option,
                              label: DRONE_ROLE_LABELS[option],
                              disabled: isBezirksDrohnenAdmin && option !== 'ADMIN',
                            }))}
                          />
                        )}
                      />
                    </div>
                    {(viewerIsBezirksAdmin || viewerIsBezirksDrohnenAdmin) && (
                      <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                        <div>
                          <div className="text-[15px] font-medium text-ink">Bezirks Drohnenadmin</div>
                          <div className="mt-0.5 text-[13px] text-ink-muted">Sieht/verwaltet alle Drohnengruppen bezirksweit</div>
                        </div>
                        <Controller
                          control={control}
                          name="isBezirksDrohnenAdmin"
                          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
                        />
                      </div>
                    )}
                    {droneRole !== 'NONE' && (
```

`SegmentedControl`'s `options` prop has no `disabled` support yet — add it. In
`src/components/ui/segmented-control.tsx`, replace:

```typescript
interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}
```

with:

```typescript
interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}
```

Replace the `<RadioGroupPrimitive.Item>` render:

```tsx
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-muted outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring',
            'data-[state=checked]:bg-white data-[state=checked]:font-semibold data-[state=checked]:text-ink data-[state=checked]:shadow-sm',
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
```

with:

```tsx
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            'rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-muted outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring',
            'data-[state=checked]:bg-white data-[state=checked]:font-semibold data-[state=checked]:text-ink data-[state=checked]:shadow-sm',
            'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
```

`data-[disabled]` (bracket syntax, not the bare `data-disabled:` shorthand) matches this codebase's own
documented Tailwind v3/shadcn-v4-generated-code fix pattern (see CLAUDE.md's "Verwaltung" section on the
`data-checked:`/`data-open:` bug) — verify this is the attribute Radix's `RadioGroupItem` actually sets when
disabled (it does, confirmed via the same `grep` verification approach CLAUDE.md documents for every other
Radix component in this codebase — check `node_modules/radix-ui/dist/index.mjs`'s `RadioGroupItem` if you
want to confirm empirically before trusting this).

- [ ] **Step 4: Verify with `tsc`, `build`, and a live-check**

```bash
npx tsc --noEmit
npm run build
```

Both must be clean.

Since this session's browser-automation harness cannot hydrate client-side React (a pre-existing,
extensively-documented limitation of this environment, not something to work around here), verify via
direct data flow reasoning plus a live DB round-trip instead of a click-test:

Create `scripts-tmp-verify-ui-roundtrip.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const testUser = await prisma.user.findFirstOrThrow({ where: { isBezirksDrohnenAdmin: false } });
  await prisma.user.update({ where: { id: testUser.id }, data: { isBezirksDrohnenAdmin: true } });
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: testUser.id } });
  console.log('isBezirksDrohnenAdmin persisted:', updated.isBezirksDrohnenAdmin === true);
  await prisma.user.update({ where: { id: testUser.id }, data: { isBezirksDrohnenAdmin: false } });
}

main().finally(() => prisma.$disconnect());
```

Run: `npx tsx scripts-tmp-verify-ui-roundtrip.ts` — must print `true`. Delete the script afterward.

Also re-read the full `user-form-sheet.tsx` file after your edits and manually trace: does
`buildDefaultValues` correctly populate both new fields when editing an existing Bezirks-Drohnenadmin user
(so re-opening their sheet shows the toggle already on and the segmented control locked to "Admin")? Does
`reset(buildDefaultValues(...))` in the existing `useEffect` (keyed on `[open, target?.id, mode]`) correctly
re-populate both fields when switching between different users' sheets without a full remount (this
codebase hit exactly this class of stale-defaultValues bug before, described in a code comment already in
this file — re-read it)?

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/user-form-sheet.tsx src/app/\(app\)/admin/benutzer/user-management-section.tsx src/app/\(app\)/admin/benutzer/page.tsx
git commit -m "Benutzerverwaltung: Bezirksadmin- und Bezirks-Drohnenadmin-Schalter im UserFormSheet"
```

---

## Final verification (after all 4 tasks)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — clean.
- [ ] Live smoke test as the seeded Bezirksadmin: open any user's edit sheet, confirm "Bezirksweite Rechte"
      section appears with an interactive "Bezirksadmin" toggle, confirm "Bezirks Drohnenadmin" toggle
      appears under the Drohnengruppe segmented control, confirm turning it on locks the segmented control
      to "Admin".
- [ ] Confirm a Feuerwehr-admin (not Bezirksadmin, not Bezirks-Drohnenadmin) opening the same sheet sees
      neither the "Bezirksweite Rechte" section nor the "Bezirks Drohnenadmin" toggle at all.
