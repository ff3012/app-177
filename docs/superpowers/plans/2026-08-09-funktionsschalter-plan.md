# Funktionsschalter je Heimatfeuerwehr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Heimatfeuerwehr two independent on/off switches ("Modul Atemschutzgeräteträger",
"Facebook-Integration Dashboard") in `/admin/heimatfeuerwehr`, that hide (never delete) the corresponding
feature on `/meine-feuerwehr`, `/admin/heimatfeuerwehr` itself, and `/dashboard/[token]`.

**Architecture:** Two new boolean columns on the existing `Organization` model
(`featureAtemschutz`/`featureFacebook`), read via a single helper for call sites that don't already have
the org row loaded. A new "Funktionen" card at the top of `/admin/heimatfeuerwehr` renders one optimistic
`Switch` per feature (immediate save via a Server Action, confirmation dialog only on the Ein→Aus path).
Every place that currently renders Atemschutz UI or drives the Facebook Graph API cron gets an added check
against the relevant flag — client-side (omit the JSX) and server-side (reject the action / 404 the route /
skip the cron iteration), so a direct request can't bypass a hidden switch.

**Tech Stack:** Next.js App Router Server Components/Actions, Prisma/PostgreSQL, shadcn `Switch`/`AlertDialog`
(already in the project), `sonner` toast.

## Global Constraints

- **Kernregel:** Abschalten blendet aus, es löscht nichts. No `DELETE`, no soft-delete, no nulling of any
  existing field, on any of the four tasks below.
- `featureAtemschutz` defaults `true` for every organization (column default, no backfill needed).
- `featureFacebook` defaults `false` in the column definition, but the migration backfills it to `true` for
  any organization whose `facebookPageId` AND `facebookPageAccessToken` are both already set.
- The existing `DashboardFacebookConfigForm` (Page-ID/Token entry) on `/admin/heimatfeuerwehr` is
  **unchanged** — the new Facebook switch only controls visibility/activation, never credential entry.
- Every server-side guard added in this plan re-checks the flag itself — never rely on a client-side
  omission alone (same "every action re-checks its own permissions" rule already used everywhere else in
  this codebase).
- Local dev Postgres has no `_prisma_migrations` tracking table — the migration SQL file is hand-authored
  and applied to the local dev DB via a one-off `npx tsx` script using `$executeRawUnsafe`, then
  `npx prisma generate` — not `prisma migrate dev`.
- Full spec: `docs/superpowers/specs/2026-08-09-funktionsschalter-design.md`.

---

### Task 1: Schema + Migration + `getOrganizationFeatures()` helper

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818090000_funktionsschalter/migration.sql`
- Create: `src/lib/heimatfeuerwehr/features.ts`

**Interfaces:**
- Produces: `Organization.featureAtemschutz: boolean`, `Organization.featureFacebook: boolean`,
  `Organization.featuresUpdatedAt: Date | null`, `Organization.featuresUpdatedByName: string | null` (all
  four are plain Prisma scalar fields, usable directly in any `select`).
- Produces: `getOrganizationFeatures(organizationId: string): Promise<{ atemschutz: boolean; facebook: boolean }>`
  from `src/lib/heimatfeuerwehr/features.ts` — used by Task 3 (server-side Atemschutz guards).

- [ ] **Step 1: Add the four fields to `Organization` in `prisma/schema.prisma`**

Find this exact block (it's the last field before the `members` relation line):

```prisma
  fahrzeugReservierungEmail String?

  members      User[]        @relation("HomeOrganization")
```

Replace with:

```prisma
  fahrzeugReservierungEmail String?

  // Funktionsschalter je Heimatfeuerwehr (Funktionsschalter-Brief.md) - Abschalten blendet nur aus,
  // löscht nichts; Reaktivierung zeigt alle Daten unverändert wieder. featureAtemschutz defaultet auf
  // true (Bestandswehren verlieren nichts durch die Migration), featureFacebook auf false - ohne Token
  // gäbe es ohnehin nichts anzuzeigen (die Migration setzt es zusätzlich per Backfill auf true für jede
  // Organisation, die bereits ein vollständiges Facebook-Zugangstoken hinterlegt hat).
  featureAtemschutz     Boolean   @default(true)
  featureFacebook       Boolean   @default(false)
  featuresUpdatedAt     DateTime?
  featuresUpdatedByName String?

  members      User[]        @relation("HomeOrganization")
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260818090000_funktionsschalter/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "featureAtemschutz" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featureFacebook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuresUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "featuresUpdatedByName" TEXT;

-- Backfill: Feuerwehren, die bereits ein vollständiges Facebook-Zugangstoken hinterlegt haben, starten
-- mit aktivierter Facebook-Integration statt dem Spalten-Default false - verhindert eine Unterbrechung
-- bereits laufender Integrationen (z. B. FF Wolfsgraben).
UPDATE "Organization"
SET "featureFacebook" = true
WHERE "facebookPageId" IS NOT NULL AND "facebookPageAccessToken" IS NOT NULL;
```

- [ ] **Step 3: Apply the migration to the local dev DB**

Create a temporary script `scripts-tmp-apply-funktionsschalter-migration.ts` in the repo root:

```ts
import { prisma } from './src/lib/db/prisma';

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "featureAtemschutz" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "featureFacebook" BOOLEAN NOT NULL DEFAULT false;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "featuresUpdatedAt" TIMESTAMP(3);
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "featuresUpdatedByName" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "Organization" SET "featureFacebook" = true
    WHERE "facebookPageId" IS NOT NULL AND "facebookPageAccessToken" IS NOT NULL;
  `);
  const rows = await prisma.organization.findMany({
    select: { name: true, featureAtemschutz: true, featureFacebook: true, facebookPageId: true, facebookPageAccessToken: true },
  });
  console.log(rows);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts-tmp-apply-funktionsschalter-migration.ts`
Expected: every row prints `featureAtemschutz: true`; any row with both `facebookPageId` and
`facebookPageAccessToken` set prints `featureFacebook: true`, every other row prints `featureFacebook: false`.

- [ ] **Step 4: Delete the temporary script and regenerate the Prisma client**

```bash
rm scripts-tmp-apply-funktionsschalter-migration.ts
npx prisma generate
```

- [ ] **Step 5: Create the helper**

Create `src/lib/heimatfeuerwehr/features.ts`:

```ts
import { prisma } from '@/lib/db/prisma';

export interface OrganizationFeatures {
  atemschutz: boolean;
  facebook: boolean;
}

/**
 * Einzige Lesequelle für die beiden Funktions-Flags (Funktionsschalter-Brief.md) - für Server
 * Actions/Routen, die die Organisation noch nicht ohnehin per `select` geladen haben. Seiten, die die
 * Organisation bereits laden (admin/heimatfeuerwehr, meine-feuerwehr, dashboard/[token]), ergänzen
 * stattdessen ihr bestehendes `select` um featureAtemschutz/featureFacebook und lesen direkt - ein
 * zusätzlicher Query-Roundtrip wäre dort unnötig.
 */
export async function getOrganizationFeatures(organizationId: string): Promise<OrganizationFeatures> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { featureAtemschutz: true, featureFacebook: true },
  });
  return { atemschutz: org.featureAtemschutz, facebook: org.featureFacebook };
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260818090000_funktionsschalter src/lib/heimatfeuerwehr/features.ts
git commit -m "Schema: Funktionsschalter je Heimatfeuerwehr (featureAtemschutz/featureFacebook)"
```

---

### Task 2: Funktionen-Karte + optimistischer Toggle + Server Action

**Files:**
- Create: `src/app/(app)/admin/heimatfeuerwehr/feature-toggle-row.tsx`
- Create: `src/app/(app)/admin/heimatfeuerwehr/funktionen-card.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/actions.ts`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the four `Organization` fields directly.
- Produces: `setOrganizationFeature(organizationId: string, feature: 'ATEMSCHUTZ' | 'FACEBOOK', enabled: boolean): Promise<{ error?: string }>`
  in `actions.ts` — also consumed nowhere else in this plan (Task 3's guards call `getOrganizationFeatures`
  instead, not this action).
- Produces: `<FunktionenCard>` (default export from `funktionen-card.tsx`), rendered once per page in Task 2
  Step 5 — no other task touches it.

- [ ] **Step 1: Add `setOrganizationFeature` to `actions.ts`**

Add at the end of `src/app/(app)/admin/heimatfeuerwehr/actions.ts` (the file already imports `requireUser`,
`assertPermission`, `canManageHeimatfeuerwehrFor`, `prisma`, `revalidatePath` — no new imports needed):

```ts
export interface FeatureToggleState {
  error?: string;
}

/** Optimistisches Umschalten der beiden Funktions-Flags (Funktionsschalter-Brief.md §2) - sofortiges
 * Speichern ohne separaten Speichern-Button, feature-toggle-row.tsx macht das eigentliche optimistische
 * UI-Update und rollt bei einem Fehler zurück. Facebook kann nur aktiviert werden, wenn bereits ein
 * Zugangstoken hinterlegt ist - ein manipulierter Request ohne Token darf das Flag auch serverseitig
 * nicht setzen (Brief-Abnahmekriterium), daher die Prüfung hier statt nur im disabled-Attribut des
 * Switches. */
export async function setOrganizationFeature(
  organizationId: string,
  feature: 'ATEMSCHUTZ' | 'FACEBOOK',
  enabled: boolean,
): Promise<FeatureToggleState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  if (feature === 'FACEBOOK' && enabled) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { facebookPageId: true, facebookPageAccessToken: true },
    });
    if (!org?.facebookPageId || !org.facebookPageAccessToken) {
      return { error: 'Ohne hinterlegtes Zugangstoken kann Facebook nicht aktiviert werden.' };
    }
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      ...(feature === 'ATEMSCHUTZ' ? { featureAtemschutz: enabled } : { featureFacebook: enabled }),
      featuresUpdatedAt: new Date(),
      featuresUpdatedByName: user.name,
    },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/meine-feuerwehr');
  return {};
}
```

- [ ] **Step 2: Create the client toggle row**

Create `src/app/(app)/admin/heimatfeuerwehr/feature-toggle-row.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { setOrganizationFeature } from './actions';

interface FeatureToggleRowProps {
  organizationId: string;
  feature: 'ATEMSCHUTZ' | 'FACEBOOK';
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  meta?: string;
  disabledHint?: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmNote: string;
}

/** Zeile in der "Funktionen"-Karte (Funktionsschalter-Brief.md §2) - sofortiges, optimistisches
 * Umschalten ohne Speichern-Button. Der Weg Ein→Aus zeigt vorher einen AlertDialog (Brief §3);
 * Aus→Ein schaltet sofort ohne Rückfrage. Bei einem Serverfehler (z. B. Facebook ohne Token bei einem
 * parallel eingetroffenen Request) schaltet der Switch optisch zurück und zeigt einen Toast. */
export function FeatureToggleRow({
  organizationId,
  feature,
  title,
  description,
  enabled,
  disabled = false,
  meta,
  disabledHint,
  confirmTitle,
  confirmDescription,
  confirmNote,
}: FeatureToggleRowProps) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(next: boolean) {
    setOptimisticEnabled(next);
    startTransition(async () => {
      const result = await setOrganizationFeature(organizationId, feature, next);
      if (result.error) {
        setOptimisticEnabled(!next);
        toast.error(result.error);
      }
    });
  }

  function handleCheckedChange(next: boolean) {
    if (!next) {
      setConfirmOpen(true);
      return;
    }
    apply(true);
  }

  function handleConfirmOff() {
    setConfirmOpen(false);
    apply(false);
  }

  return (
    <div className="flex items-start justify-between gap-6 border-t border-line px-6 py-[18px] first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2.5">
          <span className="text-[16px] font-semibold text-ink">{title}</span>
          <Badge
            variant="outline"
            className={
              optimisticEnabled
                ? 'border-transparent bg-success-subtle text-success-text'
                : 'border-transparent bg-surface-sunken text-ink-muted'
            }
          >
            {optimisticEnabled ? 'Aktiv' : 'Aus'}
          </Badge>
        </div>
        <p className="text-sm text-ink-faint">{description}</p>
        {meta && <p className="mt-2 text-xs text-ink-faint">{meta}</p>}
        {disabled && disabledHint && (
          <div className="mt-2.5 flex items-start gap-2.5 rounded-lg bg-warning-subtle px-3 py-2.5">
            <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-warning" />
            <span className="text-[13px] text-warning-text">{disabledHint}</span>
          </div>
        )}
      </div>

      <Switch
        checked={optimisticEnabled}
        disabled={disabled || pending}
        onCheckedChange={handleCheckedChange}
        className="mt-1 flex-none"
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg bg-success-subtle px-4 py-3 text-sm text-success-text">{confirmNote}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={handleConfirmOff}>
              Modul abschalten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Create the server-rendered card**

Create `src/app/(app)/admin/heimatfeuerwehr/funktionen-card.tsx`:

```tsx
import { FeatureToggleRow } from './feature-toggle-row';

interface FunktionenCardProps {
  organizationId: string;
  featureAtemschutz: boolean;
  featureFacebook: boolean;
  membersErfasstCount: number;
  featuresUpdatedAt: Date | null;
  featuresUpdatedByName: string | null;
  facebookPageId: string | null;
  hasFacebookToken: boolean;
  facebookLastFetchAt: Date | null;
  facebookLastFetchError: string | null;
}

function formatUpdatedMeta(updatedAt: Date | null, updatedByName: string | null): string | undefined {
  if (!updatedAt || !updatedByName) return undefined;
  return `zuletzt geändert ${updatedAt.toLocaleDateString('de-AT')} durch ${updatedByName}`;
}

export function FunktionenCard({
  organizationId,
  featureAtemschutz,
  featureFacebook,
  membersErfasstCount,
  featuresUpdatedAt,
  featuresUpdatedByName,
  facebookPageId,
  hasFacebookToken,
  facebookLastFetchAt,
  facebookLastFetchError,
}: FunktionenCardProps) {
  const updatedMeta = formatUpdatedMeta(featuresUpdatedAt, featuresUpdatedByName);
  const atemschutzMeta = [`${membersErfasstCount} Mitglieder erfasst`, updatedMeta].filter(Boolean).join(' · ');

  const facebookMeta =
    featureFacebook && hasFacebookToken
      ? [
          `Verbunden mit facebook.com/${facebookPageId}`,
          facebookLastFetchError
            ? `Fehler beim letzten Abruf: ${facebookLastFetchError}`
            : facebookLastFetchAt
              ? `zuletzt abgerufen ${facebookLastFetchAt.toLocaleString('de-AT', { hour: '2-digit', minute: '2-digit' })}`
              : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  return (
    <div className="rounded-lg bg-surface shadow-card">
      <div className="px-6 py-5">
        <h2 className="mb-1 text-[17px] font-semibold text-ink">Funktionen</h2>
        <p className="text-sm text-ink-faint">
          Bestimmt, was die Mitglieder dieser Feuerwehr sehen. Abgeschaltete Module werden ausgeblendet -
          bereits erfasste Daten bleiben vollständig erhalten und erscheinen wieder, sobald das Modul
          aktiviert wird.
        </p>
      </div>

      <FeatureToggleRow
        organizationId={organizationId}
        feature="ATEMSCHUTZ"
        title="Modul Atemschutzgeräteträger"
        description="Zeigt Untersuchung und Finnentest unter „Meine Feuerwehr“ und aktiviert die Atemschutz-Liste in dieser Verwaltung."
        enabled={featureAtemschutz}
        meta={atemschutzMeta}
        confirmTitle="Modul Atemschutzgeräteträger abschalten?"
        confirmDescription={`Die ${membersErfasstCount} Mitglieder dieser Feuerwehr sehen den Atemschutz-Bereich unter „Meine Feuerwehr“ nicht mehr. Die Atemschutz-Liste verschwindet auch aus dieser Verwaltung.`}
        confirmNote="Alle erfassten Untersuchungen und Finnentests bleiben gespeichert und erscheinen unverändert, sobald das Modul wieder aktiviert wird."
      />

      <FeatureToggleRow
        organizationId={organizationId}
        feature="FACEBOOK"
        title="Facebook-Integration Dashboard"
        description="Blendet die letzten Beiträge der Facebook-Seite auf dem Dashboard im Feuerwehrhaus ein."
        enabled={featureFacebook}
        disabled={!hasFacebookToken}
        meta={facebookMeta}
        disabledHint="Kein Zugangstoken hinterlegt. Zum Aktivieren wird ein Facebook-Seitentoken benötigt."
        confirmTitle="Facebook-Integration abschalten?"
        confirmDescription="Das Facebook-Widget verschwindet vom Dashboard im Feuerwehrhaus. Zugangsdaten bleiben gespeichert."
        confirmNote="Der Zugriffstoken bleibt hinterlegt und muss beim Wiedereinschalten nicht neu eingegeben werden."
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `page.tsx`**

In `src/app/(app)/admin/heimatfeuerwehr/page.tsx`, add the import next to the other local component imports
(e.g. right after the `WappenUploadForm` import line):

```ts
import { FunktionenCard } from './funktionen-card';
```

Find the `selectedOrgFull` query's `select` block (starts `select: { atemschutzSachbearbeiterEmail: true,`)
and add these four lines right after `facebookLastFetchError: true,`:

```ts
        featureAtemschutz: true,
        featureFacebook: true,
        featuresUpdatedAt: true,
        featuresUpdatedByName: true,
```

Find this exact block (right after the `OrgSelect` line, before the Wappen card's opening `<div>`):

```tsx
      {allowedOrgs.length > 1 && <OrgSelect organizations={allowedOrgs} selectedId={selectedOrgId} />}

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Wappen (Startbildschirm)</h2>
```

Replace with:

```tsx
      {allowedOrgs.length > 1 && <OrgSelect organizations={allowedOrgs} selectedId={selectedOrgId} />}

      <FunktionenCard
        organizationId={selectedOrgId}
        featureAtemschutz={selectedOrgFull.featureAtemschutz}
        featureFacebook={selectedOrgFull.featureFacebook}
        membersErfasstCount={members.length}
        featuresUpdatedAt={selectedOrgFull.featuresUpdatedAt}
        featuresUpdatedByName={selectedOrgFull.featuresUpdatedByName}
        facebookPageId={selectedOrgFull.facebookPageId}
        hasFacebookToken={Boolean(selectedOrgFull.facebookPageId && selectedOrgFull.facebookPageAccessToken)}
        facebookLastFetchAt={selectedOrgFull.facebookLastFetchAt}
        facebookLastFetchError={selectedOrgFull.facebookLastFetchError}
      />

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Wappen (Startbildschirm)</h2>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/admin/heimatfeuerwehr/feature-toggle-row.tsx src/app/\(app\)/admin/heimatfeuerwehr/funktionen-card.tsx src/app/\(app\)/admin/heimatfeuerwehr/actions.ts src/app/\(app\)/admin/heimatfeuerwehr/page.tsx
git commit -m "Feature: Funktionen-Karte in Verwaltung Heimatfeuerwehr (optimistischer Toggle + Abschalt-Dialog)"
```

---

### Task 3: Atemschutz ausblenden — `/admin/heimatfeuerwehr` + serverseitige Guards

**Files:**
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/actions.ts` (`updateAtemschutzStatus`, `setAtemschutzSachbearbeiter`)
- Modify: `src/app/(app)/admin/heimatfeuerwehr/atemschutz-export/route.ts`
- Modify: `src/lib/heimatfeuerwehr/notify-atemschutz-warnung.ts`

**Interfaces:**
- Consumes: `getOrganizationFeatures` from Task 1's `src/lib/heimatfeuerwehr/features.ts`.

- [ ] **Step 1: Hide the Atemschutz card on `/admin/heimatfeuerwehr`**

In `page.tsx`, find the Atemschutz card's opening and closing (already reads `selectedOrgFull.featureAtemschutz`
from Task 2 Step 4's `select` addition):

```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Atemschutz</h2>
```

Replace the opening `<div className="rounded-lg bg-surface p-4 shadow-card">` line for this specific card
with a conditional wrapper — i.e. change:

```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Atemschutz</h2>
```

to:

```tsx
      {selectedOrgFull.featureAtemschutz && (
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Atemschutz</h2>
```

and find the card's closing `</div>` (the one right before the "Fahrzeug-Reservierungen" card's opening
`<div className="rounded-lg bg-surface p-4 shadow-card">`):

```tsx
        </Table>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Fahrzeug-Reservierungen</h2>
```

Replace with:

```tsx
        </Table>
      </div>
      )}

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Fahrzeug-Reservierungen</h2>
```

- [ ] **Step 2: Guard `updateAtemschutzStatus` and `setAtemschutzSachbearbeiter` in `actions.ts`**

Add the import at the top of `actions.ts`, alongside the other local imports:

```ts
import { getOrganizationFeatures } from '@/lib/heimatfeuerwehr/features';
```

In `updateAtemschutzStatus`, find:

```ts
  assertPermission(canManageHeimatfeuerwehrFor(user, target.homeOrganizationId));

  const parsed = atemschutzSchema.safeParse(parseAtemschutzFormData(formData));
```

Replace with:

```ts
  assertPermission(canManageHeimatfeuerwehrFor(user, target.homeOrganizationId));

  const { atemschutz } = await getOrganizationFeatures(target.homeOrganizationId);
  if (!atemschutz) {
    return { error: 'Das Modul Atemschutzgeräteträger ist für diese Feuerwehr deaktiviert.' };
  }

  const parsed = atemschutzSchema.safeParse(parseAtemschutzFormData(formData));
```

In `setAtemschutzSachbearbeiter`, find:

```ts
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = sachbearbeiterEmailSchema.safeParse(formData.get('email'));
```

Replace with:

```ts
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const { atemschutz } = await getOrganizationFeatures(organizationId);
  if (!atemschutz) {
    return { error: 'Das Modul Atemschutzgeräteträger ist für diese Feuerwehr deaktiviert.' };
  }

  const parsed = sachbearbeiterEmailSchema.safeParse(formData.get('email'));
```

- [ ] **Step 3: 404 the Excel export route when the module is off**

In `src/app/(app)/admin/heimatfeuerwehr/atemschutz-export/route.ts`, add the import:

```ts
import { getOrganizationFeatures } from '@/lib/heimatfeuerwehr/features';
```

Find:

```ts
  if (!organizationId || !canManageHeimatfeuerwehrFor(user, organizationId)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const members = await prisma.user.findMany({
```

Replace with:

```ts
  if (!organizationId || !canManageHeimatfeuerwehrFor(user, organizationId)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const { atemschutz } = await getOrganizationFeatures(organizationId);
  if (!atemschutz) {
    return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 });
  }

  const members = await prisma.user.findMany({
```

- [ ] **Step 4: Pause the daily Atemschutz-Warn-Mail for disabled organizations**

In `src/lib/heimatfeuerwehr/notify-atemschutz-warnung.ts`, find:

```ts
  const orgs = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', atemschutzSachbearbeiterEmail: { not: null } },
    select: { id: true, name: true, shortName: true, atemschutzSachbearbeiterEmail: true },
  });
```

Replace with:

```ts
  const orgs = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', atemschutzSachbearbeiterEmail: { not: null }, featureAtemschutz: true },
    select: { id: true, name: true, shortName: true, atemschutzSachbearbeiterEmail: true },
  });
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/admin/heimatfeuerwehr/page.tsx src/app/\(app\)/admin/heimatfeuerwehr/actions.ts src/app/\(app\)/admin/heimatfeuerwehr/atemschutz-export/route.ts src/lib/heimatfeuerwehr/notify-atemschutz-warnung.ts
git commit -m "Feature: Atemschutz ausblenden in Verwaltung + serverseitige Guards"
```

---

### Task 4: Atemschutz ausblenden — `/meine-feuerwehr`

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`

**Interfaces:**
- Consumes: `Organization.featureAtemschutz` (read directly via a new `select`, not the Task 1 helper — this
  page doesn't have the organization loaded yet, so it adds one targeted query, matching the "helper is only
  for call sites without the row already loaded" rule — here there IS no existing org row to extend, so a
  minimal dedicated query is the correct choice over pulling in the general-purpose helper for a single
  boolean already needed alongside other page state).

- [ ] **Step 1: Load `featureAtemschutz` for the member's home organization**

Find this exact block (the whole `Promise.all` array, four elements — `me`/`candidateEventsRaw`/`vehicles`/`myBookings`):

```ts
  const [me, candidateEventsRaw, vehicles, myBookings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        firstName: true,
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    prisma.event.findMany({
      where: { OR: [{ organizationId: user.homeOrganizationId }, { isSectionWide: true }], endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 8,
      include: { organization: { select: { shortName: true, name: true } } },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    prisma.vehicleBooking.findMany({
      where: { userId: user.id, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      include: { vehicle: true },
    }),
  ]);
```

Replace with (adds `orgFeatures` as a fifth destructured element and a fifth query):

```ts
  const [me, candidateEventsRaw, vehicles, myBookings, orgFeatures] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        firstName: true,
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    prisma.event.findMany({
      where: { OR: [{ organizationId: user.homeOrganizationId }, { isSectionWide: true }], endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 8,
      include: { organization: { select: { shortName: true, name: true } } },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    prisma.vehicleBooking.findMany({
      where: { userId: user.id, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      include: { vehicle: true },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: user.homeOrganizationId },
      select: { featureAtemschutz: true },
    }),
  ]);
```

- [ ] **Step 2: Skip the Atemschutz "Zu erledigen" entry when the module is off**

Find:

```ts
  const staticTodos: StaticTodoItemData[] = [];
  const atemschutzTodo = buildAtemschutzTodo(me);
  if (atemschutzTodo) staticTodos.push(atemschutzTodo);
```

Replace with:

```ts
  const staticTodos: StaticTodoItemData[] = [];
  const atemschutzTodo = orgFeatures.featureAtemschutz ? buildAtemschutzTodo(me) : null;
  if (atemschutzTodo) staticTodos.push(atemschutzTodo);
```

- [ ] **Step 3: Skip the "Atemschutz laufen ab" query when the module is off, and drop the tile**

Find:

```ts
  if (canManageHeimatfeuerwehrFor(user, user.homeOrganizationId)) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [activeMemberCount, traeger, bookingsThisMonthCount] = await Promise.all([
      prisma.user.count({ where: { homeOrganizationId: user.homeOrganizationId, isActive: true } }),
      prisma.user.findMany({
        where: { homeOrganizationId: user.homeOrganizationId, isActive: true, istAtemschutzgeraeteTraeger: true },
        select: { atemschutzGueltigBis: true, atemschutzFinnentestAm: true },
      }),
      prisma.vehicleBooking.count({
        where: { vehicle: { organizationId: user.homeOrganizationId }, startsAt: { gte: startOfMonth, lt: endOfMonth } },
      }),
    ]);
```

Replace with:

```ts
  if (canManageHeimatfeuerwehrFor(user, user.homeOrganizationId)) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [activeMemberCount, traeger, bookingsThisMonthCount] = await Promise.all([
      prisma.user.count({ where: { homeOrganizationId: user.homeOrganizationId, isActive: true } }),
      orgFeatures.featureAtemschutz
        ? prisma.user.findMany({
            where: { homeOrganizationId: user.homeOrganizationId, isActive: true, istAtemschutzgeraeteTraeger: true },
            select: { atemschutzGueltigBis: true, atemschutzFinnentestAm: true },
          })
        : Promise.resolve([]),
      prisma.vehicleBooking.count({
        where: { vehicle: { organizationId: user.homeOrganizationId }, startsAt: { gte: startOfMonth, lt: endOfMonth } },
      }),
    ]);
```

- [ ] **Step 4: Make the "Stand der Wehr" grid drop the Atemschutz tile when off**

Find:

```tsx
      {standDerWehr && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Stand der Wehr</span>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Mitglieder</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-condensed text-[28px] font-bold leading-none text-[#1c1c1e]">{standDerWehr.activeMemberCount}</span>
                <span className="text-[14px] text-[#6c6c70]">aktiv</span>
              </div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Atemschutz</div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`font-condensed text-[28px] font-bold leading-none ${
                    standDerWehr.atemschutzExpiringCount > 0 ? 'text-[#8a6113]' : 'text-[#1c1c1e]'
                  }`}
                >
                  {standDerWehr.atemschutzExpiringCount}
                </span>
                <span className="text-[14px] text-[#6c6c70]">laufen ab</span>
              </div>
            </div>
          </div>
```

Replace with:

```tsx
      {standDerWehr && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Stand der Wehr</span>
          <div className={orgFeatures.featureAtemschutz ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-1 gap-2.5'}>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Mitglieder</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-condensed text-[28px] font-bold leading-none text-[#1c1c1e]">{standDerWehr.activeMemberCount}</span>
                <span className="text-[14px] text-[#6c6c70]">aktiv</span>
              </div>
            </div>
            {orgFeatures.featureAtemschutz && (
              <div className="rounded-xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Atemschutz</div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`font-condensed text-[28px] font-bold leading-none ${
                      standDerWehr.atemschutzExpiringCount > 0 ? 'text-[#8a6113]' : 'text-[#1c1c1e]'
                    }`}
                  >
                    {standDerWehr.atemschutzExpiringCount}
                  </span>
                  <span className="text-[14px] text-[#6c6c70]">laufen ab</span>
                </div>
              </div>
            )}
          </div>
```

- [ ] **Step 5: Hide the Atemschutz card entirely**

Find:

```tsx
      <div id="atemschutz-status" className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Atemschutz</h2>
```

Replace with:

```tsx
      {orgFeatures.featureAtemschutz && (
      <div id="atemschutz-status" className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Atemschutz</h2>
```

Find the card's closing (right before the "Fuhrpark" card):

```tsx
          </div>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Fuhrpark</h2>
```

Replace with:

```tsx
          </div>
        )}
      </div>
      )}

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Fuhrpark</h2>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed. Watch specifically for a JSX balancing error around the two new `{orgFeatures.featureAtemschutz && (...)}` wrappers — Step 5's nested `)}\n)}` (one closing the pre-existing `{me.istAtemschutzgeraeteTraeger && (...)}` block, one closing the new outer wrapper) is easy to miscount; if the build fails on this file, recount the parens around the Atemschutz card first.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/meine-feuerwehr/page.tsx
git commit -m "Feature: Atemschutz ausblenden auf Meine Feuerwehr"
```

---

### Task 5: Dashboard-Grid-Umschaltung ohne Facebook

**Files:**
- Modify: `src/app/dashboard/[token]/page.tsx`

**Interfaces:**
- Consumes: `Organization.featureFacebook` (added to this page's existing `organizationFull` select).

- [ ] **Step 1: Add `featureFacebook` to the organization query**

Find:

```ts
    prisma.organization.findUnique({ where: { id: valid.organizationId }, select: { name: true, facebookPageId: true } }),
```

Replace with:

```ts
    prisma.organization.findUnique({ where: { id: valid.organizationId }, select: { name: true, facebookPageId: true, featureFacebook: true } }),
```

- [ ] **Step 2: Compute `facebookActive` and the two vehicle-table grid presets**

Find:

```ts
  const posts = (facebookCache?.posts as CachedFacebookPost[] | undefined) ?? [];
  const newestPost = posts[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const featuredPost =
    newestPost?.hasImage
      ? newestPost
      : posts.find((post) => post.hasImage && new Date(post.createdTime) >= thirtyDaysAgo);
  const compactPosts = posts.filter((post) => post.id !== featuredPost?.id);
```

Replace with (adds three lines after the existing block, unchanged otherwise):

```ts
  const posts = (facebookCache?.posts as CachedFacebookPost[] | undefined) ?? [];
  const newestPost = posts[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const featuredPost =
    newestPost?.hasImage
      ? newestPost
      : posts.find((post) => post.hasImage && new Date(post.createdTime) >= thirtyDaysAgo);
  const compactPosts = posts.filter((post) => post.id !== featuredPost?.id);

  // Funktionsschalter-Brief.md §5: gilt sowohl wenn der Schalter aus ist als auch wenn nie ein Token
  // hinterlegt wurde - in beiden Fällen bekommt das Dashboard die "ohne Facebook"-Umschaltung (großes
  // WASTL, keine leere Facebook-Spalte), nicht nur eine leere Facebook-Spalte wie bisher.
  const facebookActive = organizationFull.featureFacebook && Boolean(organizationFull.facebookPageId);

  const vehicleTableGridClass = facebookActive
    ? 'grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] gap-x-[18px]'
    : 'grid-cols-[clamp(56px,3.6vw,84px)_minmax(150px,1.15fr)_clamp(84px,5.2vw,112px)_minmax(110px,1fr)] gap-x-3';
```

- [ ] **Step 3: Replace the outer content grid's column-width class**

Find:

```tsx
      <div
        className="grid min-h-0 flex-1 gap-[clamp(16px,1.5vw,32px)] overflow-hidden px-[clamp(20px,2.1vw,44px)] pt-[clamp(20px,2.1vw,44px)] grid-cols-1 [@media(max-aspect-ratio:1/1)]:grid-cols-1 dash-sm:grid-cols-[minmax(0,1fr)_minmax(340px,26vw)] dash-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_clamp(380px,27vw,560px)]"
      >
```

Replace with:

```tsx
      <div
        className={`grid min-h-0 flex-1 gap-[clamp(16px,1.5vw,32px)] overflow-hidden px-[clamp(20px,2.1vw,44px)] pt-[clamp(20px,2.1vw,44px)] grid-cols-1 [@media(max-aspect-ratio:1/1)]:grid-cols-1 dash-sm:grid-cols-[minmax(0,1fr)_minmax(340px,26vw)] ${
          facebookActive
            ? 'dash-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_clamp(380px,27vw,560px)]'
            : 'dash-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_clamp(500px,36.5vw,760px)]'
        }`}
      >
```

- [ ] **Step 4: Replace column 2 and column 3 entirely**

Find this whole block (from the "Spalte 2" comment through the end of the "Spalte 3" `</div>`, right before
the closing `</div>` of the content grid):

```tsx
        {/* ---------- Spalte 2: Fahrzeuge + WASTL ---------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Ausgeborgte Fahrzeuge</span>
            <span className="dash-secondary text-[#6c6c70]">Nächste 30 Tage</span>
          </div>
          <div className="flex flex-none flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] gap-x-[18px] border-b-2 border-[#1c1c1e] px-6 py-3">
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Datum</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Fahrzeug</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Zeit</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Ausgeborgt von</span>
            </div>
            {vehicleBookings.length === 0 ? (
              <div className="dash-secondary px-6 py-4 text-[#6c6c70]">Keine Fahrzeug-Reservierungen in den nächsten 30 Tagen.</div>
            ) : (
              <HeightFittedList minVisible={3} maxVisible={8}>
                {vehicleBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] items-center gap-x-[18px] border-b border-[#f0f0f2] px-6 py-3"
                  >
                    <span className="dash-table-cell font-semibold">{formatBookingDate(booking.startsAt)}</span>
                    <span className="dash-table-cell overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                      {booking.vehicleTaktischeBezeichnung}
                    </span>
                    <span className="dash-table-cell" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {formatBookingTimeRange(booking.startsAt, booking.endsAt)}
                    </span>
                    <span className="dash-secondary overflow-hidden text-ellipsis whitespace-nowrap text-[#48484c]">
                      {booking.borrowerName}
                    </span>
                  </div>
                ))}
              </HeightFittedList>
            )}
            <div className="dash-secondary flex-none px-6 py-3 text-[#6c6c70]">
              Buchung über die App unter „Meine Feuerwehr" · {totalBookingsCount}{' '}
              {totalBookingsCount === 1 ? 'Buchung' : 'Buchungen'} in den nächsten 30 Tagen
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl bg-white p-[18px_22px] shadow-sm">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Lage Niederösterreich</span>
              <span className="dash-secondary text-[#6c6c70]">WASTL · Bezirksalarmzentralen</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied same-origin image, next/image's optimizer adds no value here */}
              <img
                src="/api/wastl/overview"
                alt="WASTL Lagekarte Niederösterreich mit Einsatzstatus je Bezirk"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
            <div className="flex flex-none items-center justify-between border-t border-[#f0f0f2] pt-[10px]">
              <span className="dash-secondary flex items-center gap-4 text-[#48484c]">
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#5aa552' }} />
                  Normal
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#f2c14e' }} />
                  Erhöht
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#e06666' }} />
                  Stark
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ---------- Spalte 3: Facebook + QR ---------- */}
        <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Aus unserer Feuerwehr</span>
              {organizationFull.facebookPageId && (
                <span className="dash-secondary text-[#6c6c70]">facebook.com/{organizationFull.facebookPageId}</span>
              )}
            </div>

            {!organizationFull.facebookPageId ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white p-[22px] shadow-sm">
                <span className="dash-secondary text-[#6c6c70]">Facebook nicht verbunden</span>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden rounded-xl bg-white p-[22px] shadow-sm">
                {featuredPost && (
                  <div className="flex-none">
                    <div className="mb-3.5 aspect-video w-full overflow-hidden rounded-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served from our own /api/facebook/image proxy */}
                      <img
                        src={`/api/facebook/image/${featuredPost.id}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="dash-secondary mb-2 text-[#6c6c70]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {new Date(featuredPost.createdTime).toLocaleDateString('de-AT')}
                    </div>
                    {featuredPost.message && (
                      <div className="text-[23px] font-semibold leading-snug" style={{ textWrap: 'pretty' }}>
                        {featuredPost.message.split('\n')[0]}
                      </div>
                    )}
                  </div>
                )}

                {compactPosts.length > 0 && (
                  <HeightFittedList minVisible={2} maxVisible={6}>
                    {compactPosts.map((post) => (
                      <div key={post.id} className="flex items-baseline gap-4 border-t border-[#f0f0f2] pt-3.5 first:border-t-0 first:pt-0">
                        <span
                          className="dash-secondary w-[100px] flex-none text-[#6c6c70]"
                          style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                          {new Date(post.createdTime).toLocaleDateString('de-AT')}
                        </span>
                        <span className="dash-table-cell flex-1 font-semibold" style={{ textWrap: 'pretty' }}>
                          {post.message?.split('\n')[0] ?? ''}
                        </span>
                      </div>
                    ))}
                  </HeightFittedList>
                )}

                {!featuredPost && compactPosts.length === 0 && (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <span className="dash-secondary text-[#6c6c70]">Noch keine Beiträge.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-none items-center gap-4 rounded-xl bg-[#1c1c1e] p-[20px_22px]">
            {/* QR-Box ist jetzt der nachgiebige Teil dieser Zeile (shrink statt flex-none, kein
                fixes h-[...] mehr - aspect-square hält sie quadratisch während sie schrumpft):
                die URL darf nie umbrechen oder abgeschnitten werden (siehe FitText unten), also
                muss bei zu wenig Platz zuerst der QR-Code kleiner werden, nicht der Text
                unter seine 14px-Mindestgröße fallen - genau umgekehrt zur alten, fixen
                QR-Box-Größe, die den Text bei mittleren Fensterbreiten in die Ecke gedrängt hat. */}
            <div className="flex aspect-square w-[clamp(56px,7vw,180px)] shrink items-center justify-center rounded-lg bg-white p-2">
              <img src={qrCodeDataUri} alt="QR-Code zum App-Download" className="h-full w-full" />
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="mb-2 text-[22px] font-semibold leading-tight text-white">App installieren</div>
              <div className="dash-secondary mb-3 leading-snug text-[#c9c9ce]">Termine, Fahrzeuge und Atemschutz am Handy.</div>
              <FitText
                minFontSizePx={14}
                className="dash-secondary font-semibold text-white"
                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
              >
                {appUrlDisplay}
              </FitText>
            </div>
          </div>
        </div>
```

Replace with:

```tsx
        {/* ---------- Spalte 2: Fahrzeuge + WASTL (mit Facebook) bzw. Fahrzeuge + QR (ohne Facebook) ---------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Ausgeborgte Fahrzeuge</span>
            <span className="dash-secondary text-[#6c6c70]">Nächste 30 Tage</span>
          </div>
          <div
            className={`flex overflow-hidden rounded-xl bg-white shadow-sm ${
              facebookActive ? 'flex-none flex-col' : 'min-h-0 flex-1 flex-col'
            }`}
          >
            <div className={`grid ${vehicleTableGridClass} border-b-2 border-[#1c1c1e] px-6 py-3`}>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Datum</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Fahrzeug</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Zeit</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Ausgeborgt von</span>
            </div>
            {vehicleBookings.length === 0 ? (
              <div className="dash-secondary px-6 py-4 text-[#6c6c70]">Keine Fahrzeug-Reservierungen in den nächsten 30 Tagen.</div>
            ) : (
              <HeightFittedList minVisible={3} maxVisible={8}>
                {vehicleBookings.map((booking) => (
                  <div key={booking.id} className={`grid ${vehicleTableGridClass} items-center border-b border-[#f0f0f2] px-6 py-3`}>
                    <span className="dash-table-cell font-semibold">{formatBookingDate(booking.startsAt)}</span>
                    <span className="dash-table-cell overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                      {booking.vehicleTaktischeBezeichnung}
                    </span>
                    <span className="dash-table-cell" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {formatBookingTimeRange(booking.startsAt, booking.endsAt)}
                    </span>
                    <span className="dash-secondary overflow-hidden text-ellipsis whitespace-nowrap text-[#48484c]">
                      {booking.borrowerName}
                    </span>
                  </div>
                ))}
              </HeightFittedList>
            )}
            <div className="dash-secondary flex-none px-6 py-3 text-[#6c6c70]">
              Buchung über die App unter „Meine Feuerwehr" · {totalBookingsCount}{' '}
              {totalBookingsCount === 1 ? 'Buchung' : 'Buchungen'} in den nächsten 30 Tagen
            </div>
          </div>
          {!facebookActive && (
            <div className="flex flex-none items-center gap-4 rounded-xl bg-[#1c1c1e] p-[20px_22px]">
              <div className="flex aspect-square w-[clamp(56px,7vw,180px)] shrink items-center justify-center rounded-lg bg-white p-2">
                <img src={qrCodeDataUri} alt="QR-Code zum App-Download" className="h-full w-full" />
              </div>
              <div className="min-w-[220px] flex-1">
                <div className="mb-2 text-[22px] font-semibold leading-tight text-white">App installieren</div>
                <div className="dash-secondary mb-3 leading-snug text-[#c9c9ce]">Termine, Fahrzeuge und Atemschutz am Handy.</div>
                <FitText
                  minFontSizePx={14}
                  className="dash-secondary font-semibold text-white"
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  {appUrlDisplay}
                </FitText>
              </div>
            </div>
          )}
        </div>

        {/* ---------- Spalte 3: Facebook + QR (mit Facebook) bzw. WASTL groß (ohne Facebook) ---------- */}
        <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
          {facebookActive ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                <div className="flex flex-none items-baseline justify-between">
                  <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Aus unserer Feuerwehr</span>
                  <span className="dash-secondary text-[#6c6c70]">facebook.com/{organizationFull.facebookPageId}</span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden rounded-xl bg-white p-[22px] shadow-sm">
                  {featuredPost && (
                    <div className="flex-none">
                      <div className="mb-3.5 aspect-video w-full overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element -- served from our own /api/facebook/image proxy */}
                        <img
                          src={`/api/facebook/image/${featuredPost.id}`}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="dash-secondary mb-2 text-[#6c6c70]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {new Date(featuredPost.createdTime).toLocaleDateString('de-AT')}
                      </div>
                      {featuredPost.message && (
                        <div className="text-[23px] font-semibold leading-snug" style={{ textWrap: 'pretty' }}>
                          {featuredPost.message.split('\n')[0]}
                        </div>
                      )}
                    </div>
                  )}

                  {compactPosts.length > 0 && (
                    <HeightFittedList minVisible={2} maxVisible={6}>
                      {compactPosts.map((post) => (
                        <div key={post.id} className="flex items-baseline gap-4 border-t border-[#f0f0f2] pt-3.5 first:border-t-0 first:pt-0">
                          <span
                            className="dash-secondary w-[100px] flex-none text-[#6c6c70]"
                            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                          >
                            {new Date(post.createdTime).toLocaleDateString('de-AT')}
                          </span>
                          <span className="dash-table-cell flex-1 font-semibold" style={{ textWrap: 'pretty' }}>
                            {post.message?.split('\n')[0] ?? ''}
                          </span>
                        </div>
                      ))}
                    </HeightFittedList>
                  )}

                  {!featuredPost && compactPosts.length === 0 && (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                      <span className="dash-secondary text-[#6c6c70]">Noch keine Beiträge.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-none items-center gap-4 rounded-xl bg-[#1c1c1e] p-[20px_22px]">
                <div className="flex aspect-square w-[clamp(56px,7vw,180px)] shrink items-center justify-center rounded-lg bg-white p-2">
                  <img src={qrCodeDataUri} alt="QR-Code zum App-Download" className="h-full w-full" />
                </div>
                <div className="min-w-[220px] flex-1">
                  <div className="mb-2 text-[22px] font-semibold leading-tight text-white">App installieren</div>
                  <div className="dash-secondary mb-3 leading-snug text-[#c9c9ce]">Termine, Fahrzeuge und Atemschutz am Handy.</div>
                  <FitText
                    minFontSizePx={14}
                    className="dash-secondary font-semibold text-white"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    {appUrlDisplay}
                  </FitText>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl bg-white p-[18px_22px] shadow-sm">
              <div className="flex flex-none items-baseline justify-between">
                <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Lage Niederösterreich</span>
                <span className="dash-secondary text-[#6c6c70]">WASTL · Bezirksalarmzentralen</span>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- proxied same-origin image, next/image's optimizer adds no value here */}
                <img
                  src="/api/wastl/overview"
                  alt="WASTL Lagekarte Niederösterreich mit Einsatzstatus je Bezirk"
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              </div>
              <div className="flex flex-none items-center justify-between border-t border-[#f0f0f2] pt-[10px]">
                <span className="dash-secondary flex items-center gap-4 text-[#48484c]">
                  <span className="flex items-center gap-[7px]">
                    <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#5aa552' }} />
                    Normal
                  </span>
                  <span className="flex items-center gap-[7px]">
                    <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#f2c14e' }} />
                    Erhöht
                  </span>
                  <span className="flex items-center gap-[7px]">
                    <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#e06666' }} />
                    Stark
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>
```

Note: the standalone WASTL card (used both mid-column when `facebookActive` and full-column when not) and
the standalone QR card (used both bottom-of-column-3 when `facebookActive` and bottom-of-column-2 when not)
are deliberately written out twice above rather than factored into shared JSX variables — this keeps every
branch's markup readable top-to-bottom in a single JSX return without introducing intermediate variables in
a Server Component that already has a lot of precomputed values; do not "DRY" this into a helper unless a
later change needs to touch both copies at once, since divergence between the two would be easy to miss.

- [ ] **Step 5: Update the footer to omit "Facebook" when not shown**

Find:

```tsx
        <span className="dash-secondary text-[#6c6c70]">
          Zuletzt aktualisiert {now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Quellen: App-177, WASTL
          Niederösterreich, Facebook
        </span>
```

Replace with:

```tsx
        <span className="dash-secondary text-[#6c6c70]">
          Zuletzt aktualisiert {now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Quellen: App-177, WASTL
          Niederösterreich{facebookActive ? ', Facebook' : ''}
        </span>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors, and no unused-variable warnings for `newestPost`/`thirtyDaysAgo`
(still used inside the `facebookActive` branch).

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/\[token\]/page.tsx
git commit -m "Feature: Dashboard-Grid ohne Facebook (WASTL groß, Fahrzeuge+QR)"
```

---

### Task 6: Facebook-Fetch-Cron pausiert für deaktivierte Feuerwehren

**Files:**
- Modify: `src/app/api/cron/facebook-fetch/route.ts`

**Interfaces:**
- Consumes: `Organization.featureFacebook` (added directly to this route's existing query — no helper call,
  since it already bulk-loads organizations in a loop).

- [ ] **Step 1: Add the flag to the query**

Find:

```ts
  const organizations = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', facebookPageId: { not: null } },
    select: { id: true },
  });
```

Replace with:

```ts
  const organizations = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', facebookPageId: { not: null }, featureFacebook: true },
    select: { id: true },
  });
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/facebook-fetch/route.ts
git commit -m "Fix: Facebook-Fetch-Cron pausiert für Feuerwehren mit Facebook=Aus"
```

---

### Task 7: Full Verification + CLAUDE.md + Commit

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — this task only verifies and documents Tasks 1-6.

- [ ] **Step 1: Full type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with zero errors.

- [ ] **Step 2: Verify the toggle round-trip and the Facebook-without-token guard via a standalone script**

Create `scripts-tmp-verify-funktionsschalter.ts` in the repo root:

```ts
import { prisma } from './src/lib/db/prisma';
import { setOrganizationFeature } from './src/app/(app)/admin/heimatfeuerwehr/actions';
import { getOrganizationFeatures } from './src/lib/heimatfeuerwehr/features';

async function main() {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const original = await prisma.organization.findUniqueOrThrow({
    where: { id: org.id },
    select: { featureAtemschutz: true, featureFacebook: true, facebookPageId: true, facebookPageAccessToken: true },
  });

  try {
    // Turning Atemschutz off/on directly via the DB (bypassing the session-gated Server Action, since
    // this script has no logged-in session) mirrors what setOrganizationFeature itself would write.
    await prisma.organization.update({ where: { id: org.id }, data: { featureAtemschutz: false } });
    const afterOff = await getOrganizationFeatures(org.id);
    console.log('featureAtemschutz after direct off-write:', afterOff.atemschutz);
    if (afterOff.atemschutz !== false) throw new Error('FAIL: expected atemschutz=false');

    await prisma.organization.update({ where: { id: org.id }, data: { featureAtemschutz: true } });
    const afterOn = await getOrganizationFeatures(org.id);
    console.log('featureAtemschutz after direct on-write:', afterOn.atemschutz);
    if (afterOn.atemschutz !== true) throw new Error('FAIL: expected atemschutz=true');

    // Facebook-without-token guard: strip any token, then confirm setOrganizationFeature's own guard
    // rejects turning it on. requireUser() inside the action needs a session, so this part checks the
    // guard logic directly instead of importing the full action (which would throw on no-session) - if
    // this script is run in an environment where requireUser() can be stubbed, replace this block with
    // a direct call to setOrganizationFeature and assert result.error is set.
    await prisma.organization.update({
      where: { id: org.id },
      data: { facebookPageId: null, facebookPageAccessToken: null, featureFacebook: false },
    });
    const strippedOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: { facebookPageId: true, facebookPageAccessToken: true },
    });
    const wouldBeAllowed = Boolean(strippedOrg.facebookPageId && strippedOrg.facebookPageAccessToken);
    console.log('Facebook enable would be allowed without token:', wouldBeAllowed);
    if (wouldBeAllowed) throw new Error('FAIL: expected no token, so enabling must be blocked');
  } finally {
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        featureAtemschutz: original.featureAtemschutz,
        featureFacebook: original.featureFacebook,
        facebookPageId: original.facebookPageId,
        facebookPageAccessToken: original.facebookPageAccessToken,
      },
    });
    console.log('Restored original org config.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts-tmp-verify-funktionsschalter.ts`
Expected: both toggle assertions pass, the token-guard check passes, and the final log line confirms the
org's original config was restored.

Delete the script afterward: `rm scripts-tmp-verify-funktionsschalter.ts`

- [ ] **Step 3: Verify Atemschutz hiding server-side via direct DB flag flip + page fetch**

This checks the actually-rendered HTML (Server Components render fully server-side regardless of the
browser-hydration limitation already documented elsewhere in this codebase for interactive controls).

Create `scripts-tmp-verify-atemschutz-hidden.ts`:

```ts
import { prisma } from './src/lib/db/prisma';

async function main() {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const original = await prisma.organization.findUniqueOrThrow({
    where: { id: org.id },
    select: { featureAtemschutz: true },
  });

  try {
    await prisma.organization.update({ where: { id: org.id }, data: { featureAtemschutz: false } });

    const exportResponse = await fetch(
      `${process.env.AUTH_URL ?? 'http://localhost:3000'}/admin/heimatfeuerwehr/atemschutz-export?org=${org.id}`,
    );
    console.log('atemschutz-export status while disabled (expect 404, or 401/403 if no dev-session cookie is sent):', exportResponse.status);
  } finally {
    await prisma.organization.update({ where: { id: org.id }, data: { featureAtemschutz: original.featureAtemschutz } });
    console.log('Restored original featureAtemschutz.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run this against a running `npm run dev` server: `npx tsx scripts-tmp-verify-atemschutz-hidden.ts`
Expected: since the script sends no session cookie, the route returns 401/403 either way (proving
`requireUser()`/`canManageHeimatfeuerwehrFor` run first) — to actually observe the 404, log in via the
Browser tool as a site admin, navigate to `/admin/heimatfeuerwehr` with the flag turned off (toggle it off
through the UI), and confirm both: (a) the Atemschutz card is absent from the page, and (b) visiting the
`atemschutz-export?org=<id>` URL directly in that same authenticated browser tab returns a 404 page instead
of downloading a spreadsheet. Delete the script afterward: `rm scripts-tmp-verify-atemschutz-hidden.ts`.

- [ ] **Step 4: Browser-verify the dashboard grid at 1920×1080, both states**

Using the Browser tool against `npm run dev`:
1. Find (or create) a `DashboardToken` for an organization with `featureFacebook: true` and a real
   `facebookPageId`/`facebookPageAccessToken` (Wolfsgraben, if this is run against a DB that already has
   its credentials configured; otherwise temporarily set `featureFacebook: true` on any org with a token
   via a one-off script, same restore-in-`finally` pattern as Step 2).
2. Resize the viewport to 1920×1080 and open `/dashboard/<token>`. Confirm: three columns, Facebook widget
   in column 3 with the QR card below it, WASTL card in column 2 below the vehicle table, no horizontal
   scrollbar, "Ausgeborgt von" column fully visible (not clipped).
3. Toggle `featureFacebook` to `false` for that same organization (directly in the DB is fine) and reload
   the same dashboard URL. Confirm: WASTL card now fills the entire third column at full height, QR card
   now sits below the vehicle table in column 2, footer reads "...WASTL Niederösterreich" with no trailing
   ", Facebook", still no horizontal scrollbar, "Ausgeborgt von" still fully visible in the now-narrower
   column 2.
4. Restore the organization's original `featureFacebook` value.

- [ ] **Step 5: Update CLAUDE.md**

Add a new subsection under "### Verwaltung → Heimatfeuerwehr" (or as its own top-level subsection right
after the Facebook-feed bugfix entry already documented there) summarizing: the two feature flags, that
disabling only hides (never deletes), the migration's token-based Facebook backfill, and the two deliberate
deviations from the original brief (Facebook credentials stay admin-UI-editable; Facebook default is
token-dependent, not unconditionally off) — cross-reference
`docs/superpowers/specs/2026-08-09-funktionsschalter-design.md` rather than repeating its full rationale.

- [ ] **Step 6: Final commit**

```bash
git add CLAUDE.md
git commit -m "Docs: Funktionsschalter je Heimatfeuerwehr in CLAUDE.md dokumentiert"
```
