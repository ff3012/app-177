# Atemschutz-Untersuchungen: Excel-Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Heimatfeuerwehr-Admin bulk-import Atemschutz-Untersuchungs- und Finnentest-Daten from the
official external medical-examination export (a real `.xlsx` file, sheet `ExportResults`) instead of
entering each member's dates one at a time, and add a raw "Tauglichkeit" (fit/unfit) text field with a
derived traffic-light badge to both the manual edit dialog and the admin table.

**Architecture:** Two new nullable `String?` columns on `User` hold the raw Tauglichkeitsart text
(Untersuchung/Finnentest, kept as free text on purpose — no enum). A new shared, dependency-free helper
(`atemschutz-tauglichkeit.ts`) derives a 3-state traffic-light from that text and, separately, an optional
validity-duration-in-years from it. The manual edit dialog and the bulk import both write through the exact
same two fields, so a value set by either path looks identical to the other. The import itself mirrors this
codebase's existing Fuhrpark-Import pattern (`exceljs`, header-name column resolution, per-row try/catch,
`{imported, skipped, errors}` result), added as a new sub-page linked from the existing Atemschutz-Karte on
`/admin/heimatfeuerwehr`, exactly like the existing "Excel Export" link.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma/PostgreSQL, `exceljs`,
plain hand-rolled Tailwind + a handful of shadcn primitives already used on this page (`Table`, `Badge`,
`Input`, `Dialog`).

**Design spec:** `docs/superpowers/specs/2026-09-04-atemschutz-import-design.md` — read it first for the
full rationale (including why "Status" was deliberately avoided as a name); this plan implements it
task-by-task.

## Global Constraints

- No automated test suite in this repo. Every task's verification is `npx tsc --noEmit`, `npm run build`,
  and a manual check against the local dev Postgres database (via a throwaway script), matching the
  design spec's own Testing section.
- **Never call the two new fields "Status" anywhere** (Prisma field name, TS identifier, or UI label) —
  this codebase already uses "Status" for the unrelated Aktiv/Läuft-bald-ab/Abgelaufen expiry concept
  (`AtemschutzExpiryStatus` in `src/lib/heimatfeuerwehr/atemschutz-status.ts`, and the existing
  `ATEMSCHUTZ_EXCEL_COLUMNS` export columns "Status Untersuchung"/"Status Finnentest"). Use
  "Tauglichkeit"/`atemschutzTauglichkeitsart`/`atemschutzFinnentestTauglichkeitsart` consistently.
- The bulk import must respect the existing `featureAtemschutz` per-Feuerwehr toggle exactly like
  `updateAtemschutzStatus` and the existing Atemschutz-Export already do — reject with a clear error (Server
  Action) and 404 (page) when the module is disabled for the target Feuerwehr.
- The import only ever writes to members who are ALREADY `istAtemschutzgeraeteTraeger: true` — it never
  sets that flag itself, matching the literal request ("Wenn der Benutzer... aktiviert ist, dann
  importiere...").
- `atemschutzGueltigBis` is overwritten unconditionally whenever a "für N Jahre" pattern is found in the
  Tauglichkeitsart text (even if manually set before) — an explicit, already-confirmed product decision, not
  an oversight to "fix" by adding a staleness guard.
- Every Prisma write in this feature stores dates the same way the rest of this module already does:
  build a `"YYYY-MM-DD"` string, then `new Date(thatString)` (parsed as UTC midnight) — never a different
  date-construction approach, to stay consistent with `atemschutz-edit-dialog.tsx`/`updateAtemschutzStatus`.

---

## Task 1: Schema — two new `User` fields

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `User.atemschutzTauglichkeitsart: String?`, `User.atemschutzFinnentestTauglichkeitsart: String?`.
  Every later task reads/writes these two fields by exactly these names.

- [ ] **Step 1: Add the two fields to `prisma/schema.prisma`**

In `prisma/schema.prisma`'s `model User { ... }` block, find this existing block:

```prisma
  istAtemschutzgeraeteTraeger Boolean   @default(false)
  atemschutzUntersuchungAm    DateTime?
  atemschutzGueltigBis        DateTime?
  atemschutzFinnentestAm      DateTime?
```

Immediately after it (still before the `// Dienstgrad laut zentraler NÖ-Dienstgradtabelle...` comment and
`dienstgradId` block), add:

```prisma
  // Rohtext der medizinischen Tauglichkeitsbewertung aus dem Atemschutz-Untersuchungs-Import (siehe
  // docs/superpowers/specs/2026-09-04-atemschutz-import-design.md) - bewusst kein Enum, um keine
  // Information aus dem Original-Export zu verlieren. Bewusst NICHT "Status" genannt: dieser Begriff ist
  // in atemschutz-status.ts/ATEMSCHUTZ_EXCEL_COLUMNS bereits für den Gültigkeits-/Ablauf-Zustand
  // (Aktiv/Läuft bald ab/Abgelaufen) belegt - ein anderes, unabhängiges Konzept vom medizinischen
  // Tauglich/Untauglich-Ergebnis hier.
  atemschutzTauglichkeitsart           String?
  atemschutzFinnentestTauglichkeitsart String?
```

- [ ] **Step 2: Generate and apply the migration**

```bash
npm run db:migrate -- --name atemschutz_tauglichkeitsart
```

Expected: a new migration folder under `prisma/migrations/`, applied cleanly to the local dev database.
Inspect the generated `migration.sql` and confirm it contains two `ALTER TABLE "User" ADD COLUMN
"atemschutzTauglichkeitsart" TEXT;` / `ALTER TABLE "User" ADD COLUMN
"atemschutzFinnentestTauglichkeitsart" TEXT;` statements (both nullable, no `NOT NULL`, no default — this
is a genuinely optional field, unlike the `NOT NULL DEFAULT` columns other recent migrations in this repo
added).

- [ ] **Step 3: Regenerate the Prisma Client**

```bash
npx prisma generate
```

Expected: exits 0, no errors.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Expected: clean (nothing in the codebase references the two new fields yet, so this should show zero
errors, not the "expected errors elsewhere" pattern some other plans in this repo have used).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add atemschutzTauglichkeitsart fields to User"
```

---

## Task 2: Shared Tauglichkeit helper

**Files:**
- Create: `src/lib/heimatfeuerwehr/atemschutz-tauglichkeit.ts`

**Interfaces:**
- Produces: `getTauglichkeitAmpel(text: string | null): 'tauglich' | 'untauglich' | 'unbekannt'`,
  `parseGueltigkeitsdauerJahre(text: string | null): number | null`,
  `addYearsToIsoDate(isoDate: string, years: number): string`. Task 3 (display) uses the first; Task 4
  (import) uses all three.

- [ ] **Step 1: Create the file**

```ts
export type TauglichkeitAmpel = 'tauglich' | 'untauglich' | 'unbekannt';

/**
 * Leitet aus dem rohen Tauglichkeitsart-Text eine einfache Ampel ab - reine Anzeige-Vereinfachung, der
 * volle Text bleibt daneben immer sichtbar (siehe atemschutz-edit-dialog.tsx/admin/heimatfeuerwehr/
 * page.tsx). "untauglich"/"nicht bestanden" müssen VOR "tauglich"/"bestanden" geprüft werden, da
 * "untauglich" den Teilstring "tauglich" selbst enthält. Anhand aller 11 in der realen Beispieldatei
 * vorkommenden Tauglichkeitsart-Werte verifiziert (siehe docs/superpowers/specs/
 * 2026-09-04-atemschutz-import-design.md).
 */
export function getTauglichkeitAmpel(text: string | null): TauglichkeitAmpel {
  if (!text) return 'unbekannt';
  const lower = text.toLowerCase();
  if (lower.includes('untauglich') || lower.includes('nicht bestanden')) return 'untauglich';
  if (lower.includes('tauglich') || lower.includes('bestanden')) return 'tauglich';
  return 'unbekannt';
}

/**
 * Extrahiert eine Gültigkeitsdauer in Jahren aus einem Tauglichkeitsart-Text, z. B. "1X: uneingeschränkt
 * tauglich für 5 Jahre" -> 5. Liefert null, wenn kein solches Muster erkennbar ist (z. B. "tauglich (ab
 * 1.1.2017)", "untauglich") - dann bleibt atemschutzGueltigBis beim Import unverändert (siehe Design-Spec).
 */
export function parseGueltigkeitsdauerJahre(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/für\s+(\d+)\s+jahr/i);
  return match ? Number(match[1]) : null;
}

/**
 * Datum + N Jahre, als "YYYY-MM-DD" - dieselbe Darstellung, die new Date(...) im restlichen
 * Atemschutz-Modul überall erwartet (siehe atemschutz-edit-dialog.tsx's eigenes addYears). isoDate muss
 * bereits "YYYY-MM-DD" sein.
 */
export function addYearsToIsoDate(isoDate: string, years: number): string {
  const date = new Date(isoDate);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: clean.

Then verify the three functions directly with a throwaway script (delete it afterward), asserting against
all 11 real Tauglichkeitsart values from the design spec:

```
getTauglichkeitAmpel('Finnen Test bestanden') === 'tauglich'
getTauglichkeitAmpel('tauglich (ab 1.1.2017)') === 'tauglich'
getTauglichkeitAmpel('1X: uneingeschränkt tauglich für 3 Jahre (ab 3.09)') === 'tauglich'
getTauglichkeitAmpel('1X: uneingeschränkt tauglich für 5 Jahre') === 'tauglich'
getTauglichkeitAmpel('Cooper Test nicht bestanden') === 'untauglich'
getTauglichkeitAmpel('untauglich') === 'untauglich'
getTauglichkeitAmpel('tauglich') === 'tauglich'
getTauglichkeitAmpel('Fahrrad Test bestanden') === 'tauglich'
getTauglichkeitAmpel('1a: tauglich, Untersuchung im kürzeren Abstand') === 'tauglich'
getTauglichkeitAmpel('2a: vorübergehend untauglich, fachärztl. Abklärung') === 'untauglich'
getTauglichkeitAmpel('untauglich (ab 1.1.2017)') === 'untauglich'
getTauglichkeitAmpel(null) === 'unbekannt'
getTauglichkeitAmpel('') === 'unbekannt' // (empty string is falsy, same branch as null)

parseGueltigkeitsdauerJahre('1X: uneingeschränkt tauglich für 3 Jahre (ab 3.09)') === 3
parseGueltigkeitsdauerJahre('1X: uneingeschränkt tauglich für 5 Jahre') === 5
parseGueltigkeitsdauerJahre('tauglich (ab 1.1.2017)') === null
parseGueltigkeitsdauerJahre('untauglich') === null
parseGueltigkeitsdauerJahre(null) === null

addYearsToIsoDate('2026-06-27', 5) === '2031-06-27'
addYearsToIsoDate('2024-02-29', 1) === '2025-02-28' // leap-day edge case, JS Date's own rollover behavior
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/heimatfeuerwehr/atemschutz-tauglichkeit.ts
git commit -m "feat: add shared Tauglichkeit ampel/duration-parsing helper"
```

---

## Task 3: Manual edit support + display (Ampel in the admin table)

**Files:**
- Modify: `src/lib/validation/atemschutz.schema.ts`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/actions.ts`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/atemschutz-edit-dialog.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`

**Interfaces:**
- Consumes: `User.atemschutzTauglichkeitsart`/`atemschutzFinnentestTauglichkeitsart` (Task 1),
  `getTauglichkeitAmpel` (Task 2).
- Produces: extended `atemschutzSchema`/`AtemschutzInput`/`parseAtemschutzFormData`; `updateAtemschutzStatus`
  persists the two new fields; `AtemschutzEditDialog`'s `AtemschutzTarget` gains the two new string fields;
  a new `TauglichkeitBadge` component in `page.tsx`. Task 4 (import) writes the same two `User` fields this
  task makes visible/editable, so this task should land and be verified first.

- [ ] **Step 1: Extend `atemschutzSchema`/`parseAtemschutzFormData`**

In `src/lib/validation/atemschutz.schema.ts`, find:

```ts
export const atemschutzSchema = z.object({
  atemschutzUntersuchungAm: z.string().optional().or(z.literal('')),
  atemschutzGueltigBis: z.string().optional().or(z.literal('')),
  atemschutzFinnentestAm: z.string().optional().or(z.literal('')),
});
```

Replace with:

```ts
export const atemschutzSchema = z.object({
  atemschutzUntersuchungAm: z.string().optional().or(z.literal('')),
  atemschutzGueltigBis: z.string().optional().or(z.literal('')),
  atemschutzFinnentestAm: z.string().optional().or(z.literal('')),
  atemschutzTauglichkeitsart: z.string().max(200).optional().or(z.literal('')),
  atemschutzFinnentestTauglichkeitsart: z.string().max(200).optional().or(z.literal('')),
});
```

Find:

```ts
export function parseAtemschutzFormData(formData: FormData) {
  return {
    atemschutzUntersuchungAm: String(formData.get('atemschutzUntersuchungAm') ?? ''),
    atemschutzGueltigBis: String(formData.get('atemschutzGueltigBis') ?? ''),
    atemschutzFinnentestAm: String(formData.get('atemschutzFinnentestAm') ?? ''),
  };
}
```

Replace with:

```ts
export function parseAtemschutzFormData(formData: FormData) {
  return {
    atemschutzUntersuchungAm: String(formData.get('atemschutzUntersuchungAm') ?? ''),
    atemschutzGueltigBis: String(formData.get('atemschutzGueltigBis') ?? ''),
    atemschutzFinnentestAm: String(formData.get('atemschutzFinnentestAm') ?? ''),
    atemschutzTauglichkeitsart: String(formData.get('atemschutzTauglichkeitsart') ?? ''),
    atemschutzFinnentestTauglichkeitsart: String(formData.get('atemschutzFinnentestTauglichkeitsart') ?? ''),
  };
}
```

- [ ] **Step 2: Persist the two fields in `updateAtemschutzStatus`**

In `src/app/(app)/admin/heimatfeuerwehr/actions.ts`, find:

```ts
  await prisma.user.update({
    where: { id: userId },
    data: {
      atemschutzUntersuchungAm: data.atemschutzUntersuchungAm ? new Date(data.atemschutzUntersuchungAm) : null,
      atemschutzGueltigBis: data.atemschutzGueltigBis ? new Date(data.atemschutzGueltigBis) : null,
      atemschutzFinnentestAm: data.atemschutzFinnentestAm ? new Date(data.atemschutzFinnentestAm) : null,
    },
  });
```

Replace with:

```ts
  await prisma.user.update({
    where: { id: userId },
    data: {
      atemschutzUntersuchungAm: data.atemschutzUntersuchungAm ? new Date(data.atemschutzUntersuchungAm) : null,
      atemschutzGueltigBis: data.atemschutzGueltigBis ? new Date(data.atemschutzGueltigBis) : null,
      atemschutzFinnentestAm: data.atemschutzFinnentestAm ? new Date(data.atemschutzFinnentestAm) : null,
      atemschutzTauglichkeitsart: data.atemschutzTauglichkeitsart || null,
      atemschutzFinnentestTauglichkeitsart: data.atemschutzFinnentestTauglichkeitsart || null,
    },
  });
```

- [ ] **Step 3: `atemschutz-edit-dialog.tsx` — extend `AtemschutzTarget` and add two new inputs**

Find:

```tsx
interface AtemschutzTarget {
  userId: string;
  name: string;
  atemschutzUntersuchungAm: string; // "YYYY-MM-DD" oder ""
  atemschutzGueltigBis: string;
  atemschutzFinnentestAm: string;
}
```

Replace with:

```tsx
interface AtemschutzTarget {
  userId: string;
  name: string;
  atemschutzUntersuchungAm: string; // "YYYY-MM-DD" oder ""
  atemschutzGueltigBis: string;
  atemschutzFinnentestAm: string;
  atemschutzTauglichkeitsart: string;
  atemschutzFinnentestTauglichkeitsart: string;
}
```

Find:

```tsx
  const [untersuchungAm, setUntersuchungAm] = useState(target.atemschutzUntersuchungAm);
  const [gueltigBis, setGueltigBis] = useState(target.atemschutzGueltigBis);
  const [finnentestAm, setFinnentestAm] = useState(target.atemschutzFinnentestAm);
  const gueltigBisTouchedRef = useRef(Boolean(target.atemschutzGueltigBis));
```

Replace with:

```tsx
  const [untersuchungAm, setUntersuchungAm] = useState(target.atemschutzUntersuchungAm);
  const [gueltigBis, setGueltigBis] = useState(target.atemschutzGueltigBis);
  const [finnentestAm, setFinnentestAm] = useState(target.atemschutzFinnentestAm);
  const [tauglichkeitsart, setTauglichkeitsart] = useState(target.atemschutzTauglichkeitsart);
  const [finnentestTauglichkeitsart, setFinnentestTauglichkeitsart] = useState(
    target.atemschutzFinnentestTauglichkeitsart,
  );
  const gueltigBisTouchedRef = useRef(Boolean(target.atemschutzGueltigBis));
```

Find the "Gültig bis" field block:

```tsx
          <div>
            <label htmlFor="atemschutzGueltigBis" className="mb-1 block text-[13px] font-medium text-ink">
              Gültig bis
            </label>
            <Input
              id="atemschutzGueltigBis"
              name="atemschutzGueltigBis"
              type="date"
              value={gueltigBis}
              onChange={(event) => handleGueltigBisChange(event.target.value)}
            />
            <p className="mt-1 text-xs text-ink-faint">Standard 5 Jahre, laut Arzt auch kürzer möglich.</p>
          </div>
          <div>
            <label htmlFor="atemschutzFinnentestAm" className="mb-1 block text-[13px] font-medium text-ink">
              Finnentest am
            </label>
            <Input
              id="atemschutzFinnentestAm"
              name="atemschutzFinnentestAm"
              type="date"
              value={finnentestAm}
              onChange={(event) => setFinnentestAm(event.target.value)}
            />
            <p className="mt-1 text-xs text-ink-faint">Gültigkeit fix 1 Jahr.</p>
          </div>
```

Replace with:

```tsx
          <div>
            <label htmlFor="atemschutzGueltigBis" className="mb-1 block text-[13px] font-medium text-ink">
              Gültig bis
            </label>
            <Input
              id="atemschutzGueltigBis"
              name="atemschutzGueltigBis"
              type="date"
              value={gueltigBis}
              onChange={(event) => handleGueltigBisChange(event.target.value)}
            />
            <p className="mt-1 text-xs text-ink-faint">Standard 5 Jahre, laut Arzt auch kürzer möglich.</p>
          </div>
          <div>
            <label htmlFor="atemschutzTauglichkeitsart" className="mb-1 block text-[13px] font-medium text-ink">
              Tauglichkeit
            </label>
            <Input
              id="atemschutzTauglichkeitsart"
              name="atemschutzTauglichkeitsart"
              type="text"
              value={tauglichkeitsart}
              onChange={(event) => setTauglichkeitsart(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="atemschutzFinnentestAm" className="mb-1 block text-[13px] font-medium text-ink">
              Finnentest am
            </label>
            <Input
              id="atemschutzFinnentestAm"
              name="atemschutzFinnentestAm"
              type="date"
              value={finnentestAm}
              onChange={(event) => setFinnentestAm(event.target.value)}
            />
            <p className="mt-1 text-xs text-ink-faint">Gültigkeit fix 1 Jahr.</p>
          </div>
          <div>
            <label
              htmlFor="atemschutzFinnentestTauglichkeitsart"
              className="mb-1 block text-[13px] font-medium text-ink"
            >
              Tauglichkeit (Finnentest)
            </label>
            <Input
              id="atemschutzFinnentestTauglichkeitsart"
              name="atemschutzFinnentestTauglichkeitsart"
              type="text"
              value={finnentestTauglichkeitsart}
              onChange={(event) => setFinnentestTauglichkeitsart(event.target.value)}
            />
          </div>
```

- [ ] **Step 4: `admin/heimatfeuerwehr/page.tsx` — select the two new fields**

Find:

```ts
      select: {
        id: true,
        firstName: true,
        lastName: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
```

Replace with:

```ts
      select: {
        id: true,
        firstName: true,
        lastName: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
        atemschutzTauglichkeitsart: true,
        atemschutzFinnentestTauglichkeitsart: true,
      },
    }),
```

- [ ] **Step 5: Add the `TauglichkeitBadge` component**

Find the import block at the top of `page.tsx`:

```ts
import {
  getExpiryStatus,
  getFinnentestExpiryDate,
  type AtemschutzExpiryStatus,
} from '@/lib/heimatfeuerwehr/atemschutz-status';
```

Replace with:

```ts
import {
  getExpiryStatus,
  getFinnentestExpiryDate,
  type AtemschutzExpiryStatus,
} from '@/lib/heimatfeuerwehr/atemschutz-status';
import { getTauglichkeitAmpel, type TauglichkeitAmpel } from '@/lib/heimatfeuerwehr/atemschutz-tauglichkeit';
```

Find the existing `ExpiryBadge` component:

```tsx
function ExpiryBadge({ status }: { status: AtemschutzExpiryStatus }) {
  return (
    <Badge variant="outline" className={EXPIRY_BADGE_CLASS[status]}>
      {EXPIRY_BADGE_LABEL[status]}
    </Badge>
  );
}
```

Immediately after it, add:

```tsx
const TAUGLICHKEIT_BADGE_LABEL: Record<TauglichkeitAmpel, string> = {
  tauglich: 'Tauglich',
  untauglich: 'Untauglich',
  unbekannt: '–',
};

const TAUGLICHKEIT_BADGE_CLASS: Record<TauglichkeitAmpel, string> = {
  tauglich: 'border-transparent bg-success-subtle text-success-text',
  untauglich: 'border-transparent bg-danger-subtle text-danger',
  unbekannt: 'border-transparent bg-surface-sunken text-ink-faint',
};

/** Ampel + Rohtext daneben - der Text bleibt immer sichtbar, die Ampel ist nur eine Vereinfachung
 * (siehe lib/heimatfeuerwehr/atemschutz-tauglichkeit.ts). */
function TauglichkeitBadge({ text }: { text: string | null }) {
  const ampel = getTauglichkeitAmpel(text);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={TAUGLICHKEIT_BADGE_CLASS[ampel]}>
        {TAUGLICHKEIT_BADGE_LABEL[ampel]}
      </Badge>
      {text && <span className="text-xs text-ink-faint">{text}</span>}
    </span>
  );
}
```

- [ ] **Step 6: Add the two new table columns**

Find the table header:

```tsx
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Finnentest
              </TableHead>
              <TableHead />
```

Replace with:

```tsx
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Finnentest
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Tauglichkeit
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Tauglichkeit (Finnentest)
              </TableHead>
              <TableHead />
```

Find the table body row:

```tsx
                  <TableCell>
                    <ExpiryBadge status={finnentestStatus} />
                  </TableCell>
                  <TableCell className="text-right">
                    <AtemschutzEditDialog
                      target={{
                        userId: member.id,
                        name: `${member.firstName} ${member.lastName}`,
                        atemschutzUntersuchungAm: toDateInputValue(member.atemschutzUntersuchungAm),
                        atemschutzGueltigBis: toDateInputValue(member.atemschutzGueltigBis),
                        atemschutzFinnentestAm: toDateInputValue(member.atemschutzFinnentestAm),
                      }}
```

Replace with:

```tsx
                  <TableCell>
                    <ExpiryBadge status={finnentestStatus} />
                  </TableCell>
                  <TableCell>
                    <TauglichkeitBadge text={member.atemschutzTauglichkeitsart} />
                  </TableCell>
                  <TableCell>
                    <TauglichkeitBadge text={member.atemschutzFinnentestTauglichkeitsart} />
                  </TableCell>
                  <TableCell className="text-right">
                    <AtemschutzEditDialog
                      target={{
                        userId: member.id,
                        name: `${member.firstName} ${member.lastName}`,
                        atemschutzUntersuchungAm: toDateInputValue(member.atemschutzUntersuchungAm),
                        atemschutzGueltigBis: toDateInputValue(member.atemschutzGueltigBis),
                        atemschutzFinnentestAm: toDateInputValue(member.atemschutzFinnentestAm),
                        atemschutzTauglichkeitsart: member.atemschutzTauglichkeitsart ?? '',
                        atemschutzFinnentestTauglichkeitsart: member.atemschutzFinnentestTauglichkeitsart ?? '',
                      }}
```

Find the empty-state row:

```tsx
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-ink-muted">
                  Keine Atemschutzgeräteträger in dieser Feuerwehr.
                </TableCell>
              </TableRow>
            )}
```

Replace with:

```tsx
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-ink-muted">
                  Keine Atemschutzgeräteträger in dieser Feuerwehr.
                </TableCell>
              </TableRow>
            )}
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

Then verify manually against the local dev database and running dev server:
1. Set `atemschutzTauglichkeitsart`/`atemschutzFinnentestTauglichkeitsart` directly on a real seeded
   Atemschutzgeräteträger to a few of the 11 sample values from Task 2's assertions, and confirm
   `/admin/heimatfeuerwehr` renders the correct badge color + the raw text next to it for each.
2. Open the edit dialog for that member and confirm the two new "Tauglichkeit" fields show the current
   values, and that changing one and saving persists it (confirm via a direct DB read).
3. Confirm a member with `null` in both new fields shows the neutral/grey "–" badge with no text, not an
   error.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/atemschutz.schema.ts "src/app/(app)/admin/heimatfeuerwehr/actions.ts" "src/app/(app)/admin/heimatfeuerwehr/atemschutz-edit-dialog.tsx" "src/app/(app)/admin/heimatfeuerwehr/page.tsx"
git commit -m "feat: add Tauglichkeit fields to Atemschutz edit dialog and admin table"
```

---

## Task 4: Bulk Excel import

**Files:**
- Create: `src/lib/heimatfeuerwehr/atemschutz-import-columns.ts`
- Create: `src/app/(app)/admin/heimatfeuerwehr/atemschutz-import/actions.ts`
- Create: `src/app/(app)/admin/heimatfeuerwehr/atemschutz-import/import-form.tsx`
- Create: `src/app/(app)/admin/heimatfeuerwehr/atemschutz-import/page.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`

**Interfaces:**
- Consumes: `User.atemschutzTauglichkeitsart`/`atemschutzFinnentestTauglichkeitsart` (Task 1),
  `getOrganizationFeatures` (`@/lib/heimatfeuerwehr/features`), `parseGueltigkeitsdauerJahre`/
  `addYearsToIsoDate` (Task 2), `canManageHeimatfeuerwehrFor` (`@/lib/auth/permissions`).
- Produces: `importAtemschutz(organizationId, prevState, formData): Promise<ImportAtemschutzState>`. No
  other task depends on this.

- [ ] **Step 1: Create `src/lib/heimatfeuerwehr/atemschutz-import-columns.ts`**

```ts
export interface AtemschutzImportRow {
  fwNr: string;
  stbNr: string;
  untersuchtungsart: string;
  untersuchtungsdatum: string;
  tauglichkeitsart: string;
}

/** Untersuchtungsart-Werte im offiziellen Export - Rechtschreibung exakt wie in der Quelldatei
 * ("Untersuchtungsart", nicht "Untersuchungsart"), nicht korrigieren. */
export const UNTERSUCHUNGSART_TAUGLICHKEIT = 'Atemschutztauglichkeit';
export const UNTERSUCHUNGSART_LEISTUNGSTEST = 'Atemschutz Leistungstest';

/** Erwartete Spalten-Header des offiziellen Atemschutz-Untersuchungs-Exports (Sheet "ExportResults") -
 * siehe docs/superpowers/specs/2026-09-04-atemschutz-import-design.md. Reine Import-Spaltenliste, kein
 * gemeinsames Export-Template wie bei vehicle-excel-columns.ts, da diese App selbst keinen
 * Atemschutz-Export in diesem Format erzeugt - die Quelldatei stammt aus einem externen System. */
export const ATEMSCHUTZ_IMPORT_COLUMNS: { header: string; key: keyof AtemschutzImportRow }[] = [
  { header: 'FW-Nr', key: 'fwNr' },
  { header: 'StbNr', key: 'stbNr' },
  { header: 'Untersuchtungsart', key: 'untersuchtungsart' },
  { header: 'Untersuchtungsdatum', key: 'untersuchtungsdatum' },
  { header: 'Tauglichkeitsart', key: 'tauglichkeitsart' },
];
```

- [ ] **Step 2: Create `atemschutz-import/actions.ts`**

```ts
'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { getOrganizationFeatures } from '@/lib/heimatfeuerwehr/features';
import { parseGueltigkeitsdauerJahre, addYearsToIsoDate } from '@/lib/heimatfeuerwehr/atemschutz-tauglichkeit';
import {
  ATEMSCHUTZ_IMPORT_COLUMNS,
  UNTERSUCHUNGSART_TAUGLICHKEIT,
  UNTERSUCHUNGSART_LEISTUNGSTEST,
  type AtemschutzImportRow,
} from '@/lib/heimatfeuerwehr/atemschutz-import-columns';

export interface ImportAtemschutzState {
  error?: string;
  result?: { imported: number; skippedNotFound: number; skippedNotTraeger: number; errors: string[] };
}

/** Parst ein Datum aus einer Excel-Zelle - entweder ein von exceljs bereits als Date erkannter Zellwert
 * (Excel-Datumszelle) oder ein "dd.mm.yyyy"-Text (Excel-Textzelle) - beide Formen kommen in echten
 * Exports vor, je nachdem wie die Quellzelle formatiert wurde. Liefert "YYYY-MM-DD" (dieselbe
 * Darstellung, die new Date(...) im restlichen Atemschutz-Modul erwartet) oder null. */
function parseExcelDateToIso(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Org-gebunden (wie der Fuhrpark-Import): eine Zeile, deren FW-Nr nicht der aktuell gewählten
 * Feuerwehr entspricht, wird als Fehler übersprungen, nicht automatisch der richtigen Feuerwehr
 * zugeordnet - der Admin importiert bewusst für EINE Feuerwehr, nicht bezirksweit. Matching über StbNr
 * innerhalb dieser Feuerwehr; mehrfach vorhandene StbNr (User.stbNr ist nicht @unique) wird als nicht
 * eindeutig zuordenbar abgelehnt statt eine willkürliche Zeile zu treffen. Nur bereits als
 * Atemschutzgeräteträger markierte Mitglieder werden aktualisiert - der Import aktiviert dieses Flag
 * nicht selbst (siehe Design-Spec). Mehrere Zeilen für dieselbe (Mitglied, Untersuchtungsart)-
 * Kombination: die mit dem neuesten Untersuchtungsdatum gewinnt, erst nach vollständigem Einlesen
 * entschieden (nicht zeilenweise geschrieben), damit eine spätere Zeile eine frühere nicht per Zufall
 * abhängig von der Zeilenreihenfolge überschreibt.
 */
export async function importAtemschutz(
  organizationId: string,
  _prevState: ImportAtemschutzState,
  formData: FormData,
): Promise<ImportAtemschutzState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const { atemschutz } = await getOrganizationFeatures(organizationId);
  if (!atemschutz) {
    return { error: 'Das Modul Atemschutzgeräteträger ist für diese Feuerwehr deaktiviert.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Siehe fuhrpark-import/actions.ts für die Begründung des any-Casts (exceljs bringt eine eigene,
    // alte @types/node-Kopie mit, strukturell inkompatibel mit unserer @types/node@22).
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    console.error('Atemschutz-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  const columnIndexByKey = new Map<keyof AtemschutzImportRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = ATEMSCHUTZ_IMPORT_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingColumns = ATEMSCHUTZ_IMPORT_COLUMNS.filter((column) => !columnIndexByKey.has(column.key));
  if (missingColumns.length > 0) {
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingColumns.map((c) => c.header).join(', ')}.` };
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { nummer: true } });
  if (!organization) {
    return { error: 'Feuerwehr wurde nicht gefunden.' };
  }

  const members = await prisma.user.findMany({
    where: { homeOrganizationId: organizationId },
    select: { id: true, stbNr: true, istAtemschutzgeraeteTraeger: true },
  });
  const membersByStbNr = new Map<string, { id: string; istAtemschutzgeraeteTraeger: boolean }[]>();
  for (const member of members) {
    if (!member.stbNr) continue;
    const existing = membersByStbNr.get(member.stbNr) ?? [];
    existing.push({ id: member.id, istAtemschutzgeraeteTraeger: member.istAtemschutzgeraeteTraeger });
    membersByStbNr.set(member.stbNr, existing);
  }

  interface Resolved {
    userId: string;
    untersuchtungsart: string;
    untersuchtungsdatumIso: string;
    tauglichkeitsart: string;
    rowNumber: number;
  }
  const resolvedByKey = new Map<string, Resolved>();
  const errors: string[] = [];
  let skippedNotFound = 0;
  let skippedNotTraeger = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof AtemschutzImportRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return String(row.getCell(colIndex).value ?? '').trim();
    };

    const fwNr = getValue('fwNr');
    const stbNr = getValue('stbNr');
    const untersuchtungsart = getValue('untersuchtungsart');
    const tauglichkeitsart = getValue('tauglichkeitsart');
    const dateColIndex = columnIndexByKey.get('untersuchtungsdatum')!;
    const rawDate = row.getCell(dateColIndex).value;

    if (!fwNr && !stbNr && !untersuchtungsart) continue; // leere Zeile überspringen

    if (fwNr !== organization.nummer) {
      errors.push(`Zeile ${rowNumber}: Zeile gehört zu einer anderen Feuerwehr (FW-Nr ${fwNr}).`);
      continue;
    }

    const matched = membersByStbNr.get(stbNr);
    if (!matched || matched.length === 0) {
      skippedNotFound++;
      continue;
    }
    if (matched.length > 1) {
      errors.push(`Zeile ${rowNumber}: Standesbuchnummer ${stbNr} mehrfach vorhanden, Zeile übersprungen.`);
      continue;
    }
    const member = matched[0];
    if (!member.istAtemschutzgeraeteTraeger) {
      skippedNotTraeger++;
      continue;
    }

    if (untersuchtungsart !== UNTERSUCHUNGSART_TAUGLICHKEIT && untersuchtungsart !== UNTERSUCHUNGSART_LEISTUNGSTEST) {
      errors.push(`Zeile ${rowNumber}: Unbekannte Untersuchtungsart "${untersuchtungsart}".`);
      continue;
    }

    const untersuchtungsdatumIso = parseExcelDateToIso(rawDate);
    if (!untersuchtungsdatumIso) {
      errors.push(`Zeile ${rowNumber}: Ungültiges Datum in Untersuchtungsdatum.`);
      continue;
    }

    const key = `${member.id}|${untersuchtungsart}`;
    const existing = resolvedByKey.get(key);
    if (!existing || untersuchtungsdatumIso > existing.untersuchtungsdatumIso) {
      resolvedByKey.set(key, { userId: member.id, untersuchtungsart, untersuchtungsdatumIso, tauglichkeitsart, rowNumber });
    }
  }

  let imported = 0;
  for (const resolved of resolvedByKey.values()) {
    try {
      if (resolved.untersuchtungsart === UNTERSUCHUNGSART_TAUGLICHKEIT) {
        const jahre = parseGueltigkeitsdauerJahre(resolved.tauglichkeitsart);
        await prisma.user.update({
          where: { id: resolved.userId },
          data: {
            atemschutzUntersuchungAm: new Date(resolved.untersuchtungsdatumIso),
            atemschutzTauglichkeitsart: resolved.tauglichkeitsart || null,
            ...(jahre !== null
              ? { atemschutzGueltigBis: new Date(addYearsToIsoDate(resolved.untersuchtungsdatumIso, jahre)) }
              : {}),
          },
        });
      } else {
        await prisma.user.update({
          where: { id: resolved.userId },
          data: {
            atemschutzFinnentestAm: new Date(resolved.untersuchtungsdatumIso),
            atemschutzFinnentestTauglichkeitsart: resolved.tauglichkeitsart || null,
          },
        });
      }
      imported++;
    } catch (error) {
      console.error(`Atemschutz-Import Zeile ${resolved.rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${resolved.rowNumber}: Unerwarteter Fehler beim Speichern.`);
    }
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { result: { imported, skippedNotFound, skippedNotTraeger, errors } };
}
```

- [ ] **Step 3: Create `atemschutz-import/import-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { importAtemschutz, type ImportAtemschutzState } from './actions';

const initialState: ImportAtemschutzState = {};

export function ImportAtemschutzForm({ organizationId }: { organizationId: string }) {
  const boundAction = importAtemschutz.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Excel-Datei (.xlsx)</label>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <p className="text-xs text-neutral-500">
            Erwartet den offiziellen Untersuchungs-Export mit den Spalten FW-Nr, StbNr, Untersuchtungsart,
            Untersuchtungsdatum, Tauglichkeitsart. Importiert wird nur für Mitglieder, die bereits als
            Atemschutzgeräteträger markiert sind.
          </p>
        </div>

        {state.error && <p className="text-sm text-red-700">{state.error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Wird importiert…' : 'Importieren'}
          </button>
          <Link href="/admin/heimatfeuerwehr" className="text-sm text-neutral-600 hover:underline">
            Zur Heimatfeuerwehr-Verwaltung
          </Link>
        </div>
      </form>

      {state.result && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <p className="font-medium text-neutral-900">
            {state.result.imported} importiert, {state.result.skippedNotFound} übersprungen (nicht
            gefunden), {state.result.skippedNotTraeger} übersprungen (kein Atemschutzgeräteträger)
            {state.result.errors.length > 0 ? `, ${state.result.errors.length} mit Fehler` : ''}.
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {state.result.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `atemschutz-import/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { getOrganizationFeatures } from '@/lib/heimatfeuerwehr/features';
import { ImportAtemschutzForm } from './import-form';

export default async function AtemschutzImportPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const user = await requireUser();
  const { org } = await searchParams;

  if (!org || !canManageHeimatfeuerwehrFor(user, org)) {
    notFound();
  }

  const { atemschutz } = await getOrganizationFeatures(org);
  if (!atemschutz) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Atemschutz-Untersuchungen importieren</h1>
      <ImportAtemschutzForm organizationId={org} />
    </div>
  );
}
```

- [ ] **Step 5: Wire the "Excel Import" link into the main page**

In `src/app/(app)/admin/heimatfeuerwehr/page.tsx`, find:

```tsx
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Atemschutz</h2>
          <a
            href={`/admin/heimatfeuerwehr/atemschutz-export?org=${selectedOrgId}`}
            className="text-sm font-medium text-brand hover:underline"
          >
            Excel Export
          </a>
        </div>
```

Replace with:

```tsx
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Atemschutz</h2>
          <div className="flex items-center gap-3">
            <a
              href={`/admin/heimatfeuerwehr/atemschutz-import?org=${selectedOrgId}`}
              className="text-sm font-medium text-brand hover:underline"
            >
              Excel Import
            </a>
            <a
              href={`/admin/heimatfeuerwehr/atemschutz-export?org=${selectedOrgId}`}
              className="text-sm font-medium text-brand hover:underline"
            >
              Excel Export
            </a>
          </div>
        </div>
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

Then verify directly against the local dev database and the real sample file
(`C:\Users\FlorianKrebs\Downloads\202608 - Untersuchungen.xlsx`, 86 rows, one Feuerwehr):
1. Seed a handful of real test users in the dev DB under a Feuerwehr whose `Organization.nummer` is
   `"17711"` (or temporarily repoint an existing test Feuerwehr's `nummer` to `"17711"` and restore it
   afterward) with `stbNr` values matching a few real `StbNr`s from the sample file (e.g. `"29"` for Luca
   Artner, `"61"` for Maximilian Daransky) and `istAtemschutzgeraeteTraeger: true` for some of them but
   `false` for at least one, to exercise both skip categories.
2. Log in as that Feuerwehr's admin, open `/admin/heimatfeuerwehr/atemschutz-import?org=<id>`, upload the
   real sample file, and confirm the result summary's counts add up sensibly (imported count matches the
   number of Träger-flagged test rows whose StbNr was in the file; `skippedNotTraeger` matches the
   non-Träger test row; `skippedNotFound` accounts for every other real StbNr in the file that has no
   matching test user).
3. Confirm via direct DB query: the Träger-flagged Luca-Artner-equivalent test user now has
   `atemschutzUntersuchungAm` = 2020-02-09, `atemschutzTauglichkeitsart` = `"tauglich (ab 1.1.2017)"`,
   `atemschutzGueltigBis` unchanged (no "für N Jahre" pattern in that text), `atemschutzFinnentestAm` =
   2021-06-27, `atemschutzFinnentestTauglichkeitsart` = `"Finnen Test bestanden"`.
4. Confirm the "für N Jahre" case against a test user matching Christoph Dirnbacher's real row (StbNr
   `"123"`, `Untersuchtungsdatum` 14.10.2016, `Tauglichkeitsart` "1X: uneingeschränkt tauglich für 5
   Jahre") — `atemschutzGueltigBis` should be set to 2021-10-14.
5. Confirm `featureAtemschutz: false` for that Feuerwehr makes both the page (`notFound()`) and a direct
   Server Action call return the expected rejection.
6. Confirm the "Excel Import" link now appears next to "Excel Export" on `/admin/heimatfeuerwehr` for that
   Feuerwehr, and reload `/admin/heimatfeuerwehr` to confirm the imported values render with the correct
   Tauglichkeit badges from Task 3.
7. Clean up every test row you inserted/modified for this verification (test users, any temporarily
   repointed `Organization.nummer`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/heimatfeuerwehr/atemschutz-import-columns.ts "src/app/(app)/admin/heimatfeuerwehr/atemschutz-import" "src/app/(app)/admin/heimatfeuerwehr/page.tsx"
git commit -m "feat: add Atemschutz-Untersuchungen bulk Excel import"
```
