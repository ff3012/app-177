# Zweite Heimatfeuerwehr (FF + BTF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member be assigned an optional second Heimatfeuerwehr (one FF + one BTF) and self-service switch which one is active, via `docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md`.

**Architecture:** Two new nullable `User` columns (`secondaryOrganizationId`, `secondaryDienstgradId`). Admin assigns them in `UserFormSheet`. A new self-service Server Action atomically swaps `homeOrganizationId ↔ secondaryOrganizationId` and `dienstgradId ↔ secondaryDienstgradId`, triggered from the existing `ProfileMenu` dropdown. No other module changes — everything else keys off `homeOrganizationId`/`dienstgradId` unchanged.

**Tech Stack:** Next.js App Router Server Actions, Prisma/PostgreSQL, react-hook-form + zod, shadcn/ui (`Select`, `OrgSearchSelect` combobox).

## Global Constraints

- `secondaryOrganizationId`/`secondaryDienstgradId` are both nullable — no DB-level constraint enforces the FF/BTF category difference; it's an app-level check only.
- The category rule (`secondaryOrganizationId`'s `feuerwehrKategorie` must differ from `homeOrganizationId`'s) is checked **only** server-side on save in the admin form's Server Action — never as client-side filtering. The Feuerwehr picker for the secondary org is **unfiltered** (shows every Feuerwehr, same list as the existing Heimat-Feuerwehr field).
- No additional admin-rights check runs at switch time beyond the existing per-request session refresh (`build-session-user.ts` already recomputes `feuerwehrAdminOrgIds` from `Membership` on every request, independent of `homeOrganizationId`).
- The switch action only checks that the target secondary organization is `isActive: true` — nothing else blocks it, and no confirmation-frequency limit exists beyond the one confirmation dialog itself.
- Excel export/import: **out of scope**, do not touch `src/lib/admin/user-excel-columns.ts` or `import/actions.ts`.
- No merged/combined calendar view, no changes to `canViewEvent` or any Kalender/Foto-Upload/Fahrzeug-Reservierung/Push/Atemschutz code.
- This repo has no automated test suite. Verify with `npx tsc --noEmit`, `npm run build`, and (where feasible) a throwaway script against the local dev Postgres (delete the script when done — never commit it). This repo has a documented, deliberately-unfixed Prisma shadow-DB migration replay bug — apply the new migration during dev iteration with `npx prisma db execute --file <path to migration.sql>` followed by `npx prisma migrate resolve --applied <migration folder name>`, never `prisma migrate dev`.

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (the `User`, `Organization`, `Dienstgrad` models)
- Create: `prisma/migrations/20260827000000_zweite_heimatfeuerwehr/migration.sql`

**Interfaces:**
- Produces: `User.secondaryOrganizationId: string | null`, `User.secondaryDienstgradId: string | null` (Prisma scalar columns) — consumed by Task 2 (admin form) and Task 3 (switch action).

- [ ] **Step 1: Add the two new fields + their relations to `User` in `prisma/schema.prisma`**

Find this block (it currently reads, right after the existing `dienstgradId`/`dienstgrad` fields):

```prisma
  // Dienstgrad laut zentraler NÖ-Dienstgradtabelle (siehe Dienstgrad-Modell unten) - nullable, da
  // Bestandsbenutzer noch keinen zugewiesen haben.
  dienstgradId String?
  dienstgrad   Dienstgrad? @relation(fields: [dienstgradId], references: [id])

  createdPhotoUploads PhotoUpload[]
```

Replace it with (adds the two new fields directly below the existing Dienstgrad pair):

```prisma
  // Dienstgrad laut zentraler NÖ-Dienstgradtabelle (siehe Dienstgrad-Modell unten) - nullable, da
  // Bestandsbenutzer noch keinen zugewiesen haben.
  dienstgradId String?
  dienstgrad   Dienstgrad? @relation(fields: [dienstgradId], references: [id])

  // Zweite Heimatfeuerwehr (GitHub Issue #21, siehe
  // docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md) - optional, eine FF + eine
  // BTF (nie zwei vom selben Typ, app-seitig geprüft in admin/benutzer/actions.ts, kein
  // DB-Constraint). Das Mitglied kann im Profil-Dropdown zwischen homeOrganizationId/dienstgradId und
  // diesem Paar wechseln (switchHomeOrganization) - ein atomarer Tausch beider Paare, kein
  // gleichzeitiges "beides sichtbar".
  secondaryOrganizationId String?
  secondaryOrganization   Organization? @relation("SecondaryHomeOrganization", fields: [secondaryOrganizationId], references: [id])
  secondaryDienstgradId   String?
  secondaryDienstgrad     Dienstgrad?   @relation("SecondaryDienstgrad", fields: [secondaryDienstgradId], references: [id])

  createdPhotoUploads PhotoUpload[]
```

- [ ] **Step 2: Add the required back-relation array fields to `Organization` and `Dienstgrad`**

Prisma requires both sides of a relation to be declared. Find this line in the `Organization` model:

```prisma
  members      User[]        @relation("HomeOrganization")
```

Add a new line directly below it:

```prisma
  members      User[]        @relation("HomeOrganization")
  secondaryHomeMembers User[] @relation("SecondaryHomeOrganization")
```

Find this line in the `Dienstgrad` model:

```prisma
  users User[]
```

Add a new line directly below it:

```prisma
  users User[]
  secondaryDienstgradUsers User[] @relation("SecondaryDienstgrad")
```

Neither `secondaryHomeMembers` nor `secondaryDienstgradUsers` is ever queried by application code (no feature needs "all users for whom this org/Dienstgrad is the secondary one") — they exist purely because Prisma's schema validator requires both sides of a relation to be declared.

- [ ] **Step 3: Generate the Prisma client and confirm the schema is valid**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: exits 0, regenerates `node_modules/.prisma/client` with the two new fields on `User` and the two new relation arrays on `Organization`/`Dienstgrad`. If this fails with an `EPERM`/file-lock error on Windows, stop any running dev server (`preview_stop` if one was started via the Browser tool) and re-run.

- [ ] **Step 4: Write the migration SQL by hand**

Create `prisma/migrations/20260827000000_zweite_heimatfeuerwehr/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "secondaryOrganizationId" TEXT,
ADD COLUMN     "secondaryDienstgradId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_secondaryOrganizationId_fkey" FOREIGN KEY ("secondaryOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_secondaryDienstgradId_fkey" FOREIGN KEY ("secondaryDienstgradId") REFERENCES "Dienstgrad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

This mirrors the exact style of the existing `20260802201945_dienstgrad/migration.sql` (`ON DELETE SET NULL ON UPDATE CASCADE`, the convention Prisma itself uses for an optional/nullable relation). No backfill statement is needed — both columns start `NULL` for every existing row.

- [ ] **Step 5: Apply the migration to the local dev database and mark it resolved**

Run (adjust the path separator for your shell if needed):

```bash
npx prisma db execute --file prisma/migrations/20260827000000_zweite_heimatfeuerwehr/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260827000000_zweite_heimatfeuerwehr
```

Expected: both commands exit 0. This is the established workaround in this repo for the documented shadow-DB replay ordering bug — do not run `prisma migrate dev`.

- [ ] **Step 6: Verify the columns exist and are queryable**

Create a throwaway script (e.g. `scratch-verify-task1.ts` in the repo root, **delete it after running** — never commit it):

```ts
import { prisma } from './src/lib/db/prisma';

async function main() {
  const user = await prisma.user.findFirst({
    select: { id: true, secondaryOrganizationId: true, secondaryDienstgradId: true },
  });
  console.log('Sample row:', user);

  const anyOrg = await prisma.organization.findFirst({ where: { type: 'FEUERWEHR' } });
  const anyDienstgrad = await prisma.dienstgrad.findFirst();
  if (!user || !anyOrg || !anyDienstgrad) {
    console.log('Skipping write-check: missing fixture data.');
    return;
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { secondaryOrganizationId: anyOrg.id, secondaryDienstgradId: anyDienstgrad.id },
    select: { secondaryOrganizationId: true, secondaryDienstgradId: true },
  });
  console.log('After write:', updated);
  // Revert so this script leaves no side effect.
  await prisma.user.update({
    where: { id: user.id },
    data: { secondaryOrganizationId: null, secondaryDienstgradId: null },
  });
  console.log('Reverted.');
}

main().finally(() => prisma.$disconnect());
```

Run: `npx tsx scratch-verify-task1.ts`
Expected: prints a sample row with both new fields as `null`, then confirms the write succeeded with the chosen `anyOrg.id`/`anyDienstgrad.id`, then confirms the revert. Delete `scratch-verify-task1.ts` afterward.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260827000000_zweite_heimatfeuerwehr/migration.sql
git commit -m "feat: add secondary Feuerwehr/Dienstgrad columns to User (issue #21)"
```

---

### Task 2: Admin UI — assign a second Feuerwehr + Dienstgrad in Benutzerverwaltung

**Files:**
- Modify: `src/lib/validation/user.schema.ts`
- Modify: `src/app/(app)/admin/benutzer/actions.ts`
- Modify: `src/components/admin/user-form-sheet.tsx`
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx`
- Modify: `src/app/(app)/admin/benutzer/page.tsx`

**Interfaces:**
- Consumes: `User.secondaryOrganizationId`/`secondaryDienstgradId` (Task 1). `FEUERWEHR_KATEGORIE_LABEL` from `src/lib/organizations/feuerwehr-kategorie.ts` (already exists). `canManageUsersFor(user, organizationId): boolean`, `assertPermission(condition, message?)` from `src/lib/auth/permissions.ts` (already exist).
- Produces: `userSchema`'s `secondaryOrganizationId`/`secondaryDienstgradId` fields (both `z.string().optional().or(z.literal(''))`), consumed nowhere else in this plan but must stay in sync with Task 3's expectations of the `User` row shape.

- [ ] **Step 1: Extend `userSchema` and `parseUserFormData`**

In `src/lib/validation/user.schema.ts`, find:

```ts
    dienstgradId: z.string().optional().or(z.literal('')),
    homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
```

Replace with:

```ts
    dienstgradId: z.string().optional().or(z.literal('')),
    homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
    secondaryOrganizationId: z.string().optional().or(z.literal('')),
    secondaryDienstgradId: z.string().optional().or(z.literal('')),
```

Find, inside `parseUserFormData`:

```ts
    dienstgradId: String(formData.get('dienstgradId') ?? ''),
    homeOrganizationId: String(formData.get('homeOrganizationId') ?? ''),
```

Replace with:

```ts
    dienstgradId: String(formData.get('dienstgradId') ?? ''),
    homeOrganizationId: String(formData.get('homeOrganizationId') ?? ''),
    secondaryOrganizationId: String(formData.get('secondaryOrganizationId') ?? ''),
    secondaryDienstgradId: String(formData.get('secondaryDienstgradId') ?? ''),
```

- [ ] **Step 2: Run the type checker to confirm the schema change alone is consistent**

Run: `npx tsc --noEmit`
Expected: new errors in `user-form-sheet.tsx` (missing fields on `UserInput`'s consumers) — expected at this point, fixed by Step 4 below. No errors in `user.schema.ts` itself.

- [ ] **Step 3: Add the category-mismatch check + wire the two new fields into `createUser`/`updateUser`**

In `src/app/(app)/admin/benutzer/actions.ts`, add this import:

```ts
import { FEUERWEHR_KATEGORIE_LABEL } from '@/lib/organizations/feuerwehr-kategorie';
```

Add this new helper function directly above `export async function createUser(...)`:

```ts
/**
 * Prüft die Design-Regel aus docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md:
 * secondaryOrganizationId muss auf eine andere feuerwehrKategorie zeigen als homeOrganizationId
 * (eine FF + eine BTF, nie zwei vom selben Typ). Nur app-seitig geprüft (kein DB-Constraint), da
 * beide Kategorien serverseitig geladen werden müssen - kann nicht als synchrones Zod-.refine()
 * ausgedrückt werden. Gibt bei Verletzung ein fieldErrors-Objekt zurück (gleiche Form wie
 * userSchema.safeParse's eigene Fehler), sonst null.
 */
async function validateSecondaryOrganizationCategory(
  homeOrganizationId: string,
  secondaryOrganizationId: string,
): Promise<UserFormState['fieldErrors'] | null> {
  if (!secondaryOrganizationId) return null;
  const [home, secondary] = await Promise.all([
    prisma.organization.findUnique({ where: { id: homeOrganizationId }, select: { feuerwehrKategorie: true } }),
    prisma.organization.findUnique({ where: { id: secondaryOrganizationId }, select: { feuerwehrKategorie: true } }),
  ]);
  if (!home || !secondary) {
    return { secondaryOrganizationId: ['Feuerwehr wurde nicht gefunden.'] };
  }
  if (home.feuerwehrKategorie === secondary.feuerwehrKategorie) {
    const label = FEUERWEHR_KATEGORIE_LABEL[home.feuerwehrKategorie];
    const otherLabel =
      home.feuerwehrKategorie === 'FREIWILLIGE_FEUERWEHR'
        ? FEUERWEHR_KATEGORIE_LABEL.BETRIEBSFEUERWEHR
        : FEUERWEHR_KATEGORIE_LABEL.FREIWILLIGE_FEUERWEHR;
    return {
      secondaryOrganizationId: [
        `Diese Feuerwehr hat dieselbe Kategorie (${label}) wie die Heimat-Feuerwehr — bitte eine ${otherLabel} wählen.`,
      ],
    };
  }
  return null;
}
```

In `createUser`, find:

```ts
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
```

Replace with:

```ts
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
  if (data.secondaryOrganizationId) {
    assertPermission(canManageUsersFor(currentUser, data.secondaryOrganizationId));
    const categoryError = await validateSecondaryOrganizationCategory(data.homeOrganizationId, data.secondaryOrganizationId);
    if (categoryError) {
      return { fieldErrors: categoryError };
    }
  }
```

In the same function, find:

```ts
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
      passwordHash,
    },
  });
```

Replace with:

```ts
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      secondaryOrganizationId: data.secondaryOrganizationId || null,
      secondaryDienstgradId: data.secondaryDienstgradId || null,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
      passwordHash,
    },
  });
```

In `updateUser`, find:

```ts
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
```

Replace with:

```ts
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
  if (data.secondaryOrganizationId) {
    assertPermission(canManageUsersFor(currentUser, data.secondaryOrganizationId));
    const categoryError = await validateSecondaryOrganizationCategory(data.homeOrganizationId, data.secondaryOrganizationId);
    if (categoryError) {
      return { fieldErrors: categoryError };
    }
  }
```

In the same function, find:

```ts
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
    },
  });
```

Replace with:

```ts
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      secondaryOrganizationId: data.secondaryOrganizationId || null,
      secondaryDienstgradId: data.secondaryDienstgradId || null,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
    },
  });
```

- [ ] **Step 4: Extend `UserSheetTarget`, `buildDefaultValues`, `onSubmit`, and add the new form section in `user-form-sheet.tsx`**

Find the `UserSheetTarget` interface:

```ts
  dienstgradId: string;
  homeOrganizationId: string;
  homeOrgName: string;
```

Replace with:

```ts
  dienstgradId: string;
  homeOrganizationId: string;
  homeOrgName: string;
  secondaryOrganizationId: string;
  secondaryDienstgradId: string;
```

Find, inside `buildDefaultValues`:

```ts
    dienstgradId: target?.dienstgradId ?? '',
    homeOrganizationId: target?.homeOrganizationId ?? organizations[0]?.id ?? '',
```

Replace with:

```ts
    dienstgradId: target?.dienstgradId ?? '',
    homeOrganizationId: target?.homeOrganizationId ?? organizations[0]?.id ?? '',
    secondaryOrganizationId: target?.secondaryOrganizationId ?? '',
    secondaryDienstgradId: target?.secondaryDienstgradId ?? '',
```

Find, inside `onSubmit`:

```ts
    formData.set('dienstgradId', values.dienstgradId ?? '');
    formData.set('homeOrganizationId', values.homeOrganizationId);
```

Replace with:

```ts
    formData.set('dienstgradId', values.dienstgradId ?? '');
    formData.set('homeOrganizationId', values.homeOrganizationId);
    formData.set('secondaryOrganizationId', values.secondaryOrganizationId ?? '');
    formData.set('secondaryDienstgradId', values.secondaryDienstgradId ?? '');
```

Add a `watch` for the new org field (used to conditionally show the second Dienstgrad select). Find:

```ts
  const isBezirksDrohnenAdmin = watch('isBezirksDrohnenAdmin');
```

Replace with:

```ts
  const isBezirksDrohnenAdmin = watch('isBezirksDrohnenAdmin');
  const secondaryOrganizationId = watch('secondaryOrganizationId');
```

Add the new UI section. Find the end of the existing "Zuordnung" section:

```ts
                    <div>
                      <FieldLabel>Admin für</FieldLabel>
                      <Controller
                        control={control}
                        name="adminOrgIds"
                        render={({ field }) => (
                          <AdminOrgMultiSelect organizations={organizations} value={field.value} onChange={field.onChange} />
                        )}
                      />
                      <p className="mt-1 text-xs text-ink-faint">Leer lassen, wenn keine Adminrechte bestehen.</p>
                    </div>
                  </div>
                </section>
```

Replace with (adds a new field to the same section, then a second Dienstgrad select that only appears once a secondary Feuerwehr is chosen):

```ts
                    <div>
                      <FieldLabel>Admin für</FieldLabel>
                      <Controller
                        control={control}
                        name="adminOrgIds"
                        render={({ field }) => (
                          <AdminOrgMultiSelect organizations={organizations} value={field.value} onChange={field.onChange} />
                        )}
                      />
                      <p className="mt-1 text-xs text-ink-faint">Leer lassen, wenn keine Adminrechte bestehen.</p>
                    </div>
                    <div>
                      <FieldLabel htmlFor="secondaryOrganizationId">Zweite Feuerwehr (optional)</FieldLabel>
                      <Controller
                        control={control}
                        name="secondaryOrganizationId"
                        render={({ field }) => (
                          <OrgSearchSelect
                            id="secondaryOrganizationId"
                            options={organizations}
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            placeholder="Keine"
                            allLabel="Keine"
                            allValue=""
                            triggerClassName="w-full"
                          />
                        )}
                      />
                      <p className="mt-1 text-xs text-ink-faint">
                        Muss eine andere Kategorie (Freiwillige Feuerwehr/Betriebsfeuerwehr) als die
                        Heimat-Feuerwehr haben - wird beim Speichern geprüft.
                      </p>
                      <FieldError message={errors.secondaryOrganizationId?.message} />
                    </div>
                    {secondaryOrganizationId && (
                      <div>
                        <FieldLabel htmlFor="secondaryDienstgradId">Dienstgrad (zweite Feuerwehr)</FieldLabel>
                        <Controller
                          control={control}
                          name="secondaryDienstgradId"
                          render={({ field }) => (
                            <Select
                              value={field.value || 'NONE'}
                              onValueChange={(value) => field.onChange(value === 'NONE' ? '' : value)}
                            >
                              <SelectTrigger id="secondaryDienstgradId" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">–</SelectItem>
                                {dienstgrade.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    {d.kurzform}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    )}
                  </div>
                </section>
```

Note: `OrgSearchSelect`'s `allValue` prop defaults to `'ALLE'` — this usage explicitly passes `allValue=""` so the "Keine" option maps to the same empty string the schema/form already use to mean "no secondary organization", not the sentinel string `'ALLE'`.

- [ ] **Step 5: Extend `UserRow`, the `sheetTarget` mapping, and the `Organization`/`sheetTarget` wiring in `user-management-section.tsx`**

Find the `UserRow` interface:

```ts
  dienstgradId: string;
  dienstgrad: string;
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
}
```

Replace with:

```ts
  dienstgradId: string;
  dienstgrad: string;
  secondaryOrganizationId: string;
  secondaryDienstgradId: string;
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
}
```

Find, inside the `sheetTarget` construction:

```ts
        dienstgradId: sheetTargetRow.dienstgradId,
        isBezirksAdmin: sheetTargetRow.isBezirksAdmin,
```

Replace with:

```ts
        dienstgradId: sheetTargetRow.dienstgradId,
        secondaryOrganizationId: sheetTargetRow.secondaryOrganizationId,
        secondaryDienstgradId: sheetTargetRow.secondaryDienstgradId,
        isBezirksAdmin: sheetTargetRow.isBezirksAdmin,
```

- [ ] **Step 6: Add the two new fields to the `rows` mapping in `page.tsx`**

Find, inside the `users.map((u) => { ... })` block:

```ts
      dienstgradId: u.dienstgradId ?? '',
      dienstgrad: u.dienstgrad?.kurzform ?? '',
      isBezirksAdmin: u.isBezirksAdmin,
```

Replace with:

```ts
      dienstgradId: u.dienstgradId ?? '',
      dienstgrad: u.dienstgrad?.kurzform ?? '',
      secondaryOrganizationId: u.secondaryOrganizationId ?? '',
      secondaryDienstgradId: u.secondaryDienstgradId ?? '',
      isBezirksAdmin: u.isBezirksAdmin,
```

No change is needed to the `include`/`select` block of the `prisma.user.findMany` call — it uses `include` (not `select`), so Prisma already returns every scalar column (including the two new ones from Task 1) automatically.

- [ ] **Step 7: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Manual verification against the local dev DB**

Start the dev server (`preview_start` with the project's dev config), log in as an admin, open Benutzerverwaltung, edit a user:
1. Pick a "Zweite Feuerwehr" that has the **same** category as the user's Heimat-Feuerwehr → save → confirm the field-level error appears with the exact category names.
2. Pick a "Zweite Feuerwehr" with the **opposite** category → confirm a "Dienstgrad (zweite Feuerwehr)" select appears → pick a value → save → confirm no error, sheet closes.
3. Re-open the same user's edit sheet → confirm both new fields are pre-filled with the values just saved.
4. Clear "Zweite Feuerwehr" back to "Keine" → save → confirm the second Dienstgrad field disappears and both are cleared.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/user.schema.ts src/app/\(app\)/admin/benutzer/actions.ts src/components/admin/user-form-sheet.tsx src/app/\(app\)/admin/benutzer/user-management-section.tsx src/app/\(app\)/admin/benutzer/page.tsx
git commit -m "feat: assign a second Feuerwehr/Dienstgrad in Benutzerverwaltung (issue #21)"
```

---

### Task 3: Self-service switch Server Action

**Files:**
- Create: `src/app/(app)/switch-organization-action.ts`

**Interfaces:**
- Consumes: `requireUser()` from `@/lib/auth/session`, `prisma` from `@/lib/db/prisma`.
- Produces: `switchHomeOrganization(): Promise<{ error?: string }>` — a zero-argument Server Action, consumed by Task 4 as a `<form action={switchHomeOrganization}>` handler (same pattern this file's sibling `logout-action.ts` already uses for `logoutAction`).

- [ ] **Step 1: Write the action**

Create `src/app/(app)/switch-organization-action.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';

export interface SwitchOrganizationState {
  error?: string;
}

/**
 * Selbstbedienung: tauscht die eigene aktive Heimat-Feuerwehr mit der zugewiesenen zweiten
 * Feuerwehr (siehe docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md). Kein
 * eigenes Admin-Recht nötig - jeder eingeloggte User darf nur seinen eigenen Datensatz wechseln.
 * Tauscht homeOrganizationId/dienstgradId und secondaryOrganizationId/secondaryDienstgradId
 * atomar in einem einzigen prisma.user.update. Admin-Rechte (Membership-Tabelle) brauchen keine
 * eigene Prüfung hier - sie sind unabhängig von homeOrganizationId und werden bei jedem Request
 * ohnehin neu aus der Membership-Tabelle berechnet (build-session-user.ts).
 */
export async function switchHomeOrganization(): Promise<SwitchOrganizationState> {
  const currentUser = await requireUser();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: currentUser.id },
    select: {
      homeOrganizationId: true,
      dienstgradId: true,
      secondaryOrganizationId: true,
      secondaryDienstgradId: true,
    },
  });

  if (!user.secondaryOrganizationId) {
    return { error: 'Keine zweite Feuerwehr zugewiesen.' };
  }

  const target = await prisma.organization.findUnique({
    where: { id: user.secondaryOrganizationId },
    select: { isActive: true },
  });
  if (!target || !target.isActive) {
    return { error: 'Diese Feuerwehr ist aktuell deaktiviert und kann nicht aktive Heimat-Feuerwehr werden.' };
  }

  await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      homeOrganizationId: user.secondaryOrganizationId,
      secondaryOrganizationId: user.homeOrganizationId,
      dienstgradId: user.secondaryDienstgradId,
      secondaryDienstgradId: user.dienstgradId,
    },
  });

  // Betrifft praktisch jede Seite (Kalender/Foto-Uploads/Fahrzeug-Reservierung/Kopfzeile lesen alle
  // homeOrganizationId) - '/' statt eines einzelnen Pfads revalidiert layout-weit, analog zu
  // anderen session-verändernden Aktionen in diesem Codebase.
  revalidatePath('/', 'layout');
  return {};
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (this file isn't imported anywhere yet, so this mainly checks the file's own internal types).

- [ ] **Step 3: Manual verification against the local dev DB**

Using a throwaway script (delete after running, same convention as Task 1 Step 6): pick a real test user, set `secondaryOrganizationId`/`secondaryDienstgradId` directly via Prisma to a valid opposite-category Feuerwehr, then call `switchHomeOrganization` is not directly callable from a script (it calls `requireUser()`, which needs a session) — instead, verify the underlying swap logic by hand in the script:

```ts
import { prisma } from './src/lib/db/prisma';

async function main() {
  const before = await prisma.user.findFirst({
    where: { secondaryOrganizationId: { not: null } },
    select: { id: true, homeOrganizationId: true, dienstgradId: true, secondaryOrganizationId: true, secondaryDienstgradId: true },
  });
  if (!before) {
    console.log('No user with a secondary organization set yet - run this after Task 2 verification step 2.');
    return;
  }
  console.log('Before:', before);
  const after = await prisma.user.update({
    where: { id: before.id },
    data: {
      homeOrganizationId: before.secondaryOrganizationId!,
      secondaryOrganizationId: before.homeOrganizationId,
      dienstgradId: before.secondaryDienstgradId,
      secondaryDienstgradId: before.dienstgradId,
    },
    select: { homeOrganizationId: true, dienstgradId: true, secondaryOrganizationId: true, secondaryDienstgradId: true },
  });
  console.log('After swap:', after);
  // Revert
  await prisma.user.update({
    where: { id: before.id },
    data: {
      homeOrganizationId: before.homeOrganizationId,
      secondaryOrganizationId: before.secondaryOrganizationId,
      dienstgradId: before.dienstgradId,
      secondaryDienstgradId: before.secondaryDienstgradId,
    },
  });
  console.log('Reverted.');
}

main().finally(() => prisma.$disconnect());
```

Run: `npx tsx scratch-verify-task3.ts`
Expected: "After swap" shows `homeOrganizationId`/`secondaryOrganizationId` and `dienstgradId`/`secondaryDienstgradId` exactly swapped from "Before", then "Reverted." confirms cleanup. Delete the script afterward. (The `isActive`/no-secondary guard clauses and the real `requireUser()`-gated call path are exercised end-to-end in Task 4 Step 4's live browser check instead, once there's a UI to trigger it from.)

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/switch-organization-action.ts
git commit -m "feat: add self-service switchHomeOrganization Server Action (issue #21)"
```

---

### Task 4: Profile-Dropdown UI — switch button + confirmation panel

**Files:**
- Modify: `src/components/layout/profile-menu.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/lib/auth/build-session-user.ts`

**Interfaces:**
- Consumes: `switchHomeOrganization` from `@/app/(app)/switch-organization-action` (Task 3).

- [ ] **Step 1: Add the new prop, `activePanel` value, and the button + panel to `ProfileMenu`**

In `src/components/layout/profile-menu.tsx`, add the import:

```ts
import { switchHomeOrganization } from '@/app/(app)/switch-organization-action';
```

Find:

```ts
type ProfilePanel = 'password' | 'feedback' | null;
```

Replace with:

```ts
type ProfilePanel = 'password' | 'feedback' | 'switch-org' | null;
```

Find the `ProfileMenuProps` interface:

```ts
interface ProfileMenuProps {
  name: string;
  email: string;
  homeOrganizationName: string;
  isSiteAdmin: boolean;
```

Replace with:

```ts
interface ProfileMenuProps {
  name: string;
  email: string;
  homeOrganizationName: string;
  secondaryOrganizationName: string | null;
  isSiteAdmin: boolean;
```

Find the function signature's destructured props:

```ts
export function ProfileMenu({
  name,
  email,
  homeOrganizationName,
  isSiteAdmin,
```

Replace with:

```ts
export function ProfileMenu({
  name,
  email,
  homeOrganizationName,
  secondaryOrganizationName,
  isSiteAdmin,
```

Find the "Organisation" `dl` row:

```ts
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
              <dd className="text-neutral-800">{homeOrganizationName}</dd>
            </div>
```

Replace with:

```ts
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
              <dd className="flex flex-wrap items-center gap-2 text-neutral-800">
                {homeOrganizationName}
                {secondaryOrganizationName && (
                  <button
                    type="button"
                    onClick={() => setActivePanel('switch-org')}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Wechseln zu {secondaryOrganizationName}
                  </button>
                )}
              </dd>
            </div>
```

Find the panel-switching block:

```ts
            {activePanel === 'password' ? (
              <ChangePasswordForm />
            ) : activePanel === 'feedback' ? (
              <FeedbackForm />
            ) : (
```

Replace with:

```ts
            {activePanel === 'password' ? (
              <ChangePasswordForm />
            ) : activePanel === 'feedback' ? (
              <FeedbackForm />
            ) : activePanel === 'switch-org' ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-neutral-700">
                  Wirklich zu {secondaryOrganizationName} wechseln? Kalender, Foto-Uploads und Fahrzeug-Reservierung
                  zeigen danach {secondaryOrganizationName}.
                </p>
                <form action={switchHomeOrganization} className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
                  >
                    Bestätigen
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
                  >
                    Abbrechen
                  </button>
                </form>
              </div>
            ) : (
```

- [ ] **Step 2: Wire the new prop through `(app)/layout.tsx`**

Find:

```ts
    prisma.organization.findUnique({
      where: { id: user.homeOrganizationId },
      select: { id: true, name: true, shortName: true, type: true, wappenImageMimeType: true },
    }),
```

Replace with:

```ts
    prisma.organization.findUnique({
      where: { id: user.homeOrganizationId },
      select: { id: true, name: true, shortName: true, type: true, wappenImageMimeType: true },
    }),
    user.secondaryOrganizationId
      ? prisma.organization.findUnique({
          where: { id: user.secondaryOrganizationId },
          select: { name: true, shortName: true },
        })
      : Promise.resolve(null),
```

This adds a new element to the destructured `Promise.all` array. Find:

```ts
  const [homeOrganization, adminOrganizations, unreadNewsCount] = await Promise.all([
```

Replace with:

```ts
  const [homeOrganization, secondaryOrganization, adminOrganizations, unreadNewsCount] = await Promise.all([
```

Find the `<ProfileMenu` call:

```ts
              <ProfileMenu
                name={user.name}
                email={user.email}
                homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
                isSiteAdmin={isBezirksAdmin(user)}
```

Replace with:

```ts
              <ProfileMenu
                name={user.name}
                email={user.email}
                homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
                secondaryOrganizationName={secondaryOrganization ? secondaryOrganization.shortName ?? secondaryOrganization.name : null}
                isSiteAdmin={isBezirksAdmin(user)}
```

- [ ] **Step 3: Add `secondaryOrganizationId` to the `SessionUser` claims shape**

`user` in `layout.tsx` is the `SessionUser` claims object built by `src/lib/auth/build-session-user.ts`, not the raw Prisma `User` row — confirmed `secondaryOrganizationId` is not yet copied into it, so `layout.tsx`'s `user.secondaryOrganizationId` (used in Task 4 Step 2) does not compile without this step.

In `src/types/next-auth.d.ts`, find:

```ts
  homeOrganizationId: string;
  homeOrganizationType: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
```

Replace with:

```ts
  homeOrganizationId: string;
  homeOrganizationType: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  // Zweite Heimatfeuerwehr (siehe docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md) -
  // null, wenn keine zugewiesen ist.
  secondaryOrganizationId: string | null;
```

In `src/lib/auth/build-session-user.ts`, find (inside the returned object literal):

```ts
    homeOrganizationId: user.homeOrganizationId,
    homeOrganizationType: user.homeOrganization.type,
```

Replace with:

```ts
    homeOrganizationId: user.homeOrganizationId,
    homeOrganizationType: user.homeOrganization.type,
    secondaryOrganizationId: user.secondaryOrganizationId,
```

No change is needed to `userInclude` in that same file — it uses `include` (not `select`), so Prisma already returns every scalar column, including `secondaryOrganizationId` from Task 1, automatically on `user`.

Run: `npx tsc --noEmit`

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual verification against the local dev DB**

1. Using a throwaway script (delete after use), set a real test user's `secondaryOrganizationId` (to an active, opposite-category Feuerwehr) and `secondaryDienstgradId`.
2. Log in as that user in the browser.
3. Open the profile dropdown (name/avatar, top right) — confirm the "Organisation" row shows the current Heimat-Feuerwehr plus a "Wechseln zu {other org}" button.
4. Click it — confirm the confirmation panel appears with the correct org name in its text.
5. Click "Bestätigen" — confirm the dropdown's "Organisation" row now shows the other Feuerwehr's name, and the "Wechseln zu …" button now points back to the original Feuerwehr.
6. Navigate to `/kalender` (or any home-org-scoped page) — confirm it now reflects the new active Feuerwehr.
7. Switch back — confirm everything reverts correctly, including via a second real switch (not just a DB rollback).
8. Log in as a user with **no** secondary organization set — confirm the "Wechseln zu …" button and the "switch-org" panel never appear at all.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/profile-menu.tsx src/app/\(app\)/layout.tsx src/types/next-auth.d.ts src/lib/auth/build-session-user.ts
git commit -m "feat: add Feuerwehr-switch button to profile dropdown (issue #21)"
```
