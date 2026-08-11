# Drohnengruppe Qualifikationsfilter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin-only, multi-select "Qualifikation" filter to `/drohnen` (Flugbuch) that
narrows both the flight list and the Gruppenstatus bar list to pilots matching selected training
levels, with AND semantics across multiple selections.

**Architecture:** A pure, dependency-free helper function (`matchesQualification`) classifies a
membership row against a selected set of qualification keys. `/drohnen/page.tsx`'s existing
member query is extended to also load the five training fields, computes one matching-ID set from
it, and reuses that set to filter both the Gruppenstatus list and the flight query — so the two
views can never show different people for the same filter. `FlightSidebar` gets a new hand-rolled
checkbox dropdown (no shadcn — this module is deliberately hand-rolled, see CLAUDE.md) writing a
new `?qualifikation=` URL parameter, following the exact same pattern as every other filter on
this page.

**Tech Stack:** Next.js App Router Server Components, Prisma, Tailwind. No test framework exists
in this repo — verification happens via a standalone `tsx` script for the pure logic and manual
dev-server checks for the UI, matching this repo's established practice.

## Global Constraints

- Qualification keys reuse the existing `AUSBILDUNGSSTUFEN`/`Ausbildungsstufe` vocabulary from
  `@/lib/validation/user.schema` (`a1a3LizenzAm`, `a2LizenzAm`, `stuetzpunktausbildungAm`,
  `bos1AusbildungAm`, `bos2AusbildungAm`) plus one new literal `'NONE'` for "Ohne Ausbildung" — no
  second, parallel enum of the same five stages.
- Multi-select semantics are AND: a member must satisfy every selected condition simultaneously.
  `'NONE'` checks `a1a3LizenzAm === null`. Do not special-case the resulting-in-zero-matches
  combination of `'NONE'` + a real stage, or the redundant-but-correct collapse of e.g. `bos1AusbildungAm` +
  `a2LizenzAm` down to just the BOS1 condition — both are expected, correct consequences of AND
  logic, not bugs to guard against.
- Admin-only, matching the existing "Pilot" select's own `isAdmin`-gating exactly — a plain member
  never sees this filter.
- The existing `listDrohnengruppeMembers` (`src/lib/drone/members.ts`) is NOT modified — it is
  shared by the flight form, the 90-day report, and other call sites that don't need training
  fields. `/drohnen/page.tsx` gets its own, separate, extended query instead.
- URL parameter: `?qualifikation=` as a comma-separated list of the keys above (e.g.
  `?qualifikation=bos1AusbildungAm,a2LizenzAm`). Absent/empty means "no filter active" — never
  "all six selected". Changing it resets `take`, exactly like every other filter on this page
  (`setParam` already does this generically).
- Security note for the task reviewer: this filter is purely subtractive over an already
  permission-scoped query (`baseWhere` already restricts a non-admin to their own flights) — even
  if a non-admin manually crafted a `?qualifikation=` URL despite the UI never exposing it to
  them, the added `pilotUserId: { in: [...] }` constraint can only narrow their already-scoped
  result set further, never expand it. No additional guard is needed beyond the existing
  `isAdmin`-gated UI.
- No changes to `DrohnengruppeMembership`, the training-field data entry (`UserFormSheet`), or the
  Einsatzbereitschaft dashboard (`/admin/drohnen/einsatzbereitschaft`) — this plan only reads
  already-existing data for one new display filter.

---

### Task 1: Qualification-matching helper

**Files:**
- Create: `src/lib/drone/qualification-filter.ts`

**Interfaces:**
- Consumes: `AUSBILDUNGSSTUFEN`, `type Ausbildungsstufe` from `@/lib/validation/user.schema`
  (both already exist, unchanged).
- Produces (used by Task 2):
  - `QUALIFICATION_NONE = 'NONE'` (string literal constant).
  - `QUALIFICATION_OPTIONS: { key: Ausbildungsstufe | 'NONE'; label: string }[]` — six entries, in
    display order: A1/A3, A2, Stützpunktausbildung, BOS1, BOS2, then "Ohne Ausbildung" last.
  - `matchesQualification(membership: Record<Ausbildungsstufe, Date | null>, selected: string[]): boolean`.

- [ ] **Step 1: Create the helper module**

Write `src/lib/drone/qualification-filter.ts` with this exact content:

```typescript
import { AUSBILDUNGSSTUFEN, type Ausbildungsstufe } from '@/lib/validation/user.schema';

export const QUALIFICATION_NONE = 'NONE';

const QUALIFICATION_LABELS: Record<Ausbildungsstufe, string> = {
  a1a3LizenzAm: 'A1/A3 Pilotenlizenz',
  a2LizenzAm: 'A2 Pilotenlizenz',
  stuetzpunktausbildungAm: 'Stützpunktausbildung',
  bos1AusbildungAm: 'BOS1 Ausbildung',
  bos2AusbildungAm: 'BOS2 Ausbildung',
};

export const QUALIFICATION_OPTIONS: { key: Ausbildungsstufe | typeof QUALIFICATION_NONE; label: string }[] = [
  ...AUSBILDUNGSSTUFEN.map((key) => ({ key, label: QUALIFICATION_LABELS[key] })),
  { key: QUALIFICATION_NONE, label: 'Ohne Ausbildung' },
];

type MembershipDates = Record<Ausbildungsstufe, Date | null>;

/**
 * UND-Verknüpfung: ein Mitglied muss ALLE ausgewählten Bedingungen gleichzeitig erfüllen.
 * 'NONE' prüft, dass die erste Stufe (a1a3LizenzAm) NICHT gesetzt ist - da die Stufen sequenziell
 * aufeinander aufbauen (A1/A3 -> A2 -> Stützpunktausbildung -> BOS1 -> BOS2), bedeutet ein
 * ungesetztes a1a3LizenzAm automatisch, dass keine der fünf Stufen erreicht ist. Kombinationen wie
 * "BOS1 + A2" kollabieren dadurch praktisch auf "BOS1" (wer BOS1 hat, hat automatisch A2) - keine
 * Sonderbehandlung nötig, nur eine Konsequenz der UND-Logik. Ebenso liefert 'NONE' zusammen mit
 * einer echten Stufe konsequent immer false (widersprüchlich) - auch das bewusst nicht abgefangen.
 */
export function matchesQualification(membership: MembershipDates, selected: string[]): boolean {
  return selected.every((key) =>
    key === QUALIFICATION_NONE ? membership.a1a3LizenzAm === null : membership[key as Ausbildungsstufe] !== null,
  );
}
```

- [ ] **Step 2: Write a standalone verification script**

Create `scripts/verify-qualification-filter.ts` (temporary, deleted in Step 4 — this repo has no
test framework, and this function is pure with no DB dependency, so a plain script is enough):

```typescript
import { matchesQualification, QUALIFICATION_NONE, QUALIFICATION_OPTIONS } from '../src/lib/drone/qualification-filter';

function membership(overrides: Partial<Record<string, Date | null>> = {}) {
  return {
    a1a3LizenzAm: null,
    a2LizenzAm: null,
    stuetzpunktausbildungAm: null,
    bos1AusbildungAm: null,
    bos2AusbildungAm: null,
    ...overrides,
  } as Record<string, Date | null> as Parameters<typeof matchesQualification>[0];
}

const now = new Date();
const checks: Array<[boolean, string]> = [
  // No filter selected -> always true
  [matchesQualification(membership(), []) === true, 'empty selection matches everyone'],
  // Single real stage
  [matchesQualification(membership({ bos1AusbildungAm: now }), ['bos1AusbildungAm']) === true, 'BOS1-holder matches BOS1 filter'],
  [matchesQualification(membership({ a2LizenzAm: now }), ['bos1AusbildungAm']) === false, 'A2-only does not match BOS1 filter'],
  // Sequential collapse: BOS1 holder also has a2LizenzAm set in real data, so BOS1+A2 together still matches
  [
    matchesQualification(membership({ a2LizenzAm: now, bos1AusbildungAm: now }), ['bos1AusbildungAm', 'a2LizenzAm']) === true,
    'BOS1+A2 together matches a real BOS1 holder (sequential collapse, not a bug)',
  ],
  // NONE
  [matchesQualification(membership(), [QUALIFICATION_NONE]) === true, 'no training at all matches NONE'],
  [matchesQualification(membership({ a1a3LizenzAm: now }), [QUALIFICATION_NONE]) === false, 'A1/A3 holder does not match NONE'],
  // Contradictory combination
  [
    matchesQualification(membership({ a1a3LizenzAm: now, bos1AusbildungAm: now }), [QUALIFICATION_NONE, 'bos1AusbildungAm']) === false,
    'NONE + a real stage together always yields false',
  ],
  // Options list shape
  [QUALIFICATION_OPTIONS.length === 6, 'exactly 6 options'],
  [QUALIFICATION_OPTIONS[QUALIFICATION_OPTIONS.length - 1].key === QUALIFICATION_NONE, '"Ohne Ausbildung" is listed last'],
];

for (const [ok, message] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${message}`);
}

process.exit(checks.some(([ok]) => !ok) ? 1 : 0);
```

- [ ] **Step 3: Run the verification script**

Run: `npx tsx scripts/verify-qualification-filter.ts`
Expected: every line prints `OK`, no `FAIL`, exit code 0.

- [ ] **Step 4: Run `tsc --noEmit`, delete the script, commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
rm scripts/verify-qualification-filter.ts
git add src/lib/drone/qualification-filter.ts
git commit -m "Drohnengruppe: Qualifikations-Filter-Logik"
```

---

### Task 2: Wire the filter into `/drohnen` and `FlightSidebar`

**Files:**
- Modify: `src/app/(app)/drohnen/page.tsx`
- Modify: `src/components/drone/flight-sidebar.tsx`

**Interfaces:**
- Consumes: `QUALIFICATION_OPTIONS`, `matchesQualification` from Task 1's
  `@/lib/drone/qualification-filter`.
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Fetch the extended member list BEFORE `filterWhere`, not inside the big `Promise.all`**

**Why this must move**: `matchingMemberIds` (computed from `members`) needs to feed into
`filterWhere`, which in turn feeds into the `where` clause used by the flights query — but the
flights query and the member query both currently live in the SAME `Promise.all`, run in
parallel. You cannot use one parallel query's result to build another query that runs in the same
batch. The member fetch must be `await`ed on its own, before `filterWhere`/`where` are
constructed, and REMOVED from the later `Promise.all` entirely.

Read the current full file first to see the exact present order: `selectedGroup` resolution, then
`cutoff`/`scope`/`take`, then `baseWhere`/`scopeWhere`/`filterWhere`/`where`, then the big
`Promise.all` (which currently includes the member query as one of its array entries), then
post-processing (`pilots`, `groupMembers`, `groupStatusPilots`, `flightRows`).

Add `qualifikation?: string;` to the `searchParams` type (alongside the existing
`gruppe`/`q`/`pilot`/etc. fields).

Add this import near the other `@/lib/drone/*` imports:
```typescript
import { QUALIFICATION_OPTIONS, matchesQualification } from '@/lib/drone/qualification-filter';
```

Remove the `listDrohnengruppeMembers` import — after this task it is no longer used anywhere in
this file (it was only used for the one member query being replaced and moved; confirm this by
checking the rest of the file before removing the import).

Immediately after the `selectedGroup` resolution (right before the existing `const cutoff =
zeitraumCutoff(...)` line), insert the new, separately-awaited member fetch and the derived
values:

```typescript
  // Muss VOR filterWhere/where laufen und AUSSERHALB der späteren Promise.all - matchingMemberIds
  // fließt in dieselbe Flug-Query ein, die weiter unten aus `where` gebaut wird, kann also nicht
  // parallel zu ihr in derselben Promise.all stehen.
  const members = isAdmin
    ? await prisma.drohnengruppeMembership.findMany({
        where: { droneGroupId: selectedGroup.id },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        select: {
          a1a3LizenzAm: true,
          a2LizenzAm: true,
          stuetzpunktausbildungAm: true,
          bos1AusbildungAm: true,
          bos2AusbildungAm: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : [];

  const selectedQualifications = (params.qualifikation ?? '').split(',').filter(Boolean);
  // Der Pilot-Select zeigt bewusst IMMER alle Gruppenmitglieder als Optionen, unabhängig vom
  // Qualifikations-Filter - dieselbe Unabhängigkeit gilt bereits zwischen allen anderen Filtern
  // dieser Seite (z. B. schränkt der Zweck-Filter die Drohnen-Optionen auch nicht ein).
  const pilots = members.map((m) => ({ id: m.user.id, name: `${m.user.lastName} ${m.user.firstName}` }));
  const groupMembers =
    selectedQualifications.length > 0 ? members.filter((m) => matchesQualification(m, selectedQualifications)) : members;
  const matchingMemberIds = new Set(groupMembers.map((m) => m.user.id));
```

- [ ] **Step 2: Remove the member query from the big `Promise.all` and update its destructuring**

Find the `isAdmin ? listDrohnengruppeMembers(selectedGroup.id) : Promise.resolve([])` entry inside
the `Promise.all([...])` array further down the file and DELETE that entire array entry (including
its trailing comma) — the member fetch now happens earlier, per Step 1, not here.

Update the `Promise.all` destructuring line to drop the `members` name it used to receive (it's no
longer one of this `Promise.all`'s results):

```typescript
  const [flights, totalCount, allScopeCount, meineCount, fuerAndereErfasstCount, ownFlightsInWindow, lastOwnFlight, groupFlightsInWindow, drones] =
    await Promise.all([
```

(This is the same list of names as before, just with `members` removed from the middle — every
other entry keeps its existing position and query unchanged.)

Also remove these now-redundant lines that used to sit right after the `Promise.all` destructuring
(Step 1 already computed `pilots`/`groupMembers`/`matchingMemberIds` earlier, before the queries
that need them):

```typescript
  const pilots = members;
  const groupMembers = members;
```

- [ ] **Step 3: Update `groupStatusPilots` to read from the new member shape**

The `groupStatusPilots` computation currently reads `member.id`/`member.lastName`/`member.firstName`
directly. Since `groupMembers` (from Step 1) now holds the nested-`user` shape, update it:

```typescript
  const groupStatusPilots: GroupStatusPilot[] = groupMembers.map((member) => {
    const dates = flightDatesByPilot.get(member.user.id) ?? [];
    const count = dates.length;
    const met = meetsNinetyDayRule(count);
    const daysLeft = met ? getDaysUntilExpiry(dates) : null;
    const status: GroupStatusPilot['status'] = !met ? 'danger' : daysLeft !== null && daysLeft <= 14 ? 'warning' : 'success';
    return { id: member.user.id, name: `${member.user.lastName} ${member.user.firstName}`, count, status };
  });
```

(Only the three `member.id`/`member.lastName`/`member.firstName` reads become `member.user.id`/
`member.user.lastName`/`member.user.firstName` — the rest of the function body is unchanged.)

- [ ] **Step 4: Add the qualification constraint to the flight query's `filterWhere` — as an `AND` array, not plain object-key spreads**

Find the existing `filterWhere` declaration (it sits between `baseWhere`/`scopeWhere` and the
`where` that combines all three — after Step 1's insertion, `selectedQualifications`/
`matchingMemberIds` are now already in scope above it, so `filterWhere` itself does NOT need to
move):

```typescript
  const filterWhere = {
    ...(params.pilot ? { pilotUserId: params.pilot } : {}),
    ...(params.drohne ? { droneId: params.drohne } : {}),
    ...(params.zweck === 'EINSATZ' || params.zweck === 'UEBUNG' ? { purpose: params.zweck as 'EINSATZ' | 'UEBUNG' } : {}),
    ...(cutoff ? { startsAt: { gte: cutoff } } : {}),
    ...(params.q ? { location: { contains: params.q, mode: 'insensitive' as const } } : {}),
  };
```

Replace it with an `AND`-array form instead of adding a sixth plain spread. This is a deliberate,
necessary change, not just style: the qualification constraint and the single-pilot constraint
both use the key `pilotUserId` (one as an exact match, one as `{ in: [...] }`) — if both were
separate plain-object spreads in the same literal and both were active at once, the one spread
later would silently overwrite the other via plain object-key collision, breaking whichever filter
lost. An `AND` array keeps every active condition simultaneously enforced regardless of how many
of them happen to touch the same underlying column:

```typescript
  const filterWhere = {
    AND: [
      ...(params.pilot ? [{ pilotUserId: params.pilot }] : []),
      ...(params.drohne ? [{ droneId: params.drohne }] : []),
      ...(params.zweck === 'EINSATZ' || params.zweck === 'UEBUNG' ? [{ purpose: params.zweck as 'EINSATZ' | 'UEBUNG' }] : []),
      ...(cutoff ? [{ startsAt: { gte: cutoff } }] : []),
      ...(params.q ? [{ location: { contains: params.q, mode: 'insensitive' as const } }] : []),
      ...(selectedQualifications.length > 0 ? [{ pilotUserId: { in: Array.from(matchingMemberIds) } }] : []),
    ],
  };
```

Verify this specific interaction in Step 9's manual check: with BOTH `?pilot=<id>` AND
`?qualifikation=bos1AusbildungAm` set at once, the result must be the intersection of both (that
one pilot, and only if they have BOS1) — not just whichever filter's `pilotUserId` form happened
to be applied.

- [ ] **Step 5: Include `qualifikation` in the "no results" filter-active check**

Find this line (the empty-state branch):

```typescript
              {params.pilot || params.drohne || params.zweck || params.q ? (
```

and add `params.qualifikation` to it:

```typescript
              {params.pilot || params.drohne || params.zweck || params.q || params.qualifikation ? (
```

- [ ] **Step 6: Pass the options into `FlightSidebar`**

Find the `<FlightSidebar ... />` call and add one prop:

```tsx
          <FlightSidebar
            pilots={pilots}
            drones={drones.map((d) => ({ id: d.id, name: d.name }))}
            totalCount={allScopeCount}
            meineCount={meineCount}
            fuerAndereErfasstCount={fuerAndereErfasstCount}
            isAdmin={isAdmin}
            qualificationOptions={QUALIFICATION_OPTIONS}
          />
```

(`pilots` no longer needs `.map(...)` here since Step 1 already built it in the final `{id, name}`
shape directly.)

- [ ] **Step 7: Add the qualification dropdown to `FlightSidebar`**

In `src/components/drone/flight-sidebar.tsx`, add `useState` to the existing React import:

```typescript
import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
```

Add `qualificationOptions: { key: string; label: string }[]` to the `FlightFilterOptions`
interface:

```typescript
export interface FlightFilterOptions {
  pilots: { id: string; name: string }[];
  drones: { id: string; name: string }[];
  totalCount: number;
  meineCount: number;
  fuerAndereErfasstCount: number;
  isAdmin: boolean;
  qualificationOptions: { key: string; label: string }[];
}
```

Destructure the new prop in the component signature:

```typescript
export function FlightSidebar({ pilots, drones, totalCount, meineCount, fuerAndereErfasstCount, isAdmin, qualificationOptions }: FlightFilterOptions) {
```

Right after the existing `const zeitraum = ...` line, add:

```typescript
  const [qualificationOpen, setQualificationOpen] = useState(false);
  const selectedQualifications = (searchParams.get('qualifikation') ?? '').split(',').filter(Boolean);

  function toggleQualification(key: string) {
    const next = selectedQualifications.includes(key)
      ? selectedQualifications.filter((k) => k !== key)
      : [...selectedQualifications, key];
    setParam('qualifikation', next.join(','));
  }
```

(`toggleQualification` is defined after `setParam` in the file — place it after `setParam`'s own
closing brace, not before, since it calls `setParam`.)

In the JSX, find the closing `</div>` of the Pilot/Drohne/Zeitraum filter block (the `<div
className="flex flex-col gap-2.5 border-t border-line pt-3.5">...</div>` containing the three
`<label>` selects) and insert this new block immediately after it, before the "Zweck" legend
block:

```tsx
      {isAdmin && (
        <div className="relative border-t border-line pt-3.5">
          <button
            type="button"
            onClick={() => setQualificationOpen((open) => !open)}
            className="flex h-[38px] w-full items-center justify-between rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
          >
            <span>
              Qualifikation{selectedQualifications.length > 0 ? ` (${selectedQualifications.length})` : ''}
            </span>
            <span className="text-ink-faint">▾</span>
          </button>
          {qualificationOpen && (
            <div className="absolute z-10 mt-1 flex w-full flex-col gap-2 rounded-md border border-line bg-surface p-3 shadow-card">
              {qualificationOptions.map((option) => (
                <label key={option.key} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={selectedQualifications.includes(option.key)}
                    onChange={() => toggleQualification(option.key)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 8: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Manual verification against the local dev server**

Run `npm run dev` (or reuse an already-running instance). As an admin with more than one training
level represented among the group's members:
- Open the "Qualifikation" dropdown, select "BOS1 Ausbildung" — confirm both the flight list and
  the Gruppenstatus bar list narrow to only BOS1 holders, and the button label shows "Qualifikation
  (1)".
- Additionally select "A2 Pilotenlizenz" while BOS1 is still selected — confirm the result set is
  unchanged (every BOS1 holder already has A2), not empty.
- Select "Ohne Ausbildung" together with "BOS1 Ausbildung" — confirm this yields zero results, not
  an error.
- Reload the page with the resulting `?qualifikation=...` URL still in the address bar — confirm
  the checkboxes and the filtered results persist across the reload.
- With `?qualifikation=bos1AusbildungAm` active, additionally pick a single specific non-BOS1 pilot
  from the "Pilot" select — confirm the flight list becomes empty (correct AND-intersection between
  the two independent filters, verifying Step 4's `AND`-array fix), not a list showing that pilot's
  flights regardless of qualification.
- As a plain (non-admin) Drohnengruppe member: confirm the "Qualifikation" control does not appear
  at all.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/drohnen/page.tsx" src/components/drone/flight-sidebar.tsx
git commit -m "Drohnengruppe: Qualifikations-Filter im Flugbuch verdrahtet"
```

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage**: §1 (Umfang, 6 Optionen, wirkt auf beide Ansichten) → Task 2 Steps 1-4; §2
  (UND-Logik inkl. beider Rand-Konsequenzen) → Task 1's `matchesQualification` + its verification
  script's explicit test cases; §3 (gemeinsame Datenquelle, kein Auseinanderlaufen) → Task 2 Step 1
  (`matchingMemberIds` shared by both `groupStatusPilots` and `filterWhere`); §4 (hand-gerollter
  Dropdown) → Task 2 Step 7; §5 (URL-Zustand) → Task 2 Steps 1/7; §6 (Nicht-Ziele) → nothing in
  either task touches `DrohnengruppeMembership`, `UserFormSheet`, or the Einsatzbereitschaft
  dashboard; §7 (Abnahme) → covered by Task 2 Step 9's manual verification list.
- **Placeholder scan**: no TBD/TODO. The one explicit "read the current full file to confirm the
  present order" note in Task 2 Step 1 tells the implementer exactly what to check before editing,
  not a vague "handle appropriately."
- **A real bug was caught and fixed during this plan's own writing**, not left for a task reviewer
  to find later: the naive approach of adding `pilotUserId: { in: [...] }` as a plain object key
  alongside the existing `pilotUserId: params.pilot` key would have silently made the two mutually
  exclusive via object-key overwrite (whichever spread runs last wins) instead of combining them.
  Task 2 Step 4 converts `filterWhere` to an explicit `AND` array specifically to keep both filters
  independently combinable, and Step 9's verification list includes a concrete test for this exact
  interaction. Also caught in the same pass: the original draft tried to compute `matchingMemberIds`
  from a member query living inside the same `Promise.all` as the flights query that needed to
  consume it — a circular dependency that cannot work, since parallel queries in one `Promise.all`
  can't see each other's results. Fixed by pulling the member fetch out into its own `await`,
  before `filterWhere`/`where` are built (Task 2 Step 1), and removing it from the later
  `Promise.all` entirely (Task 2 Step 2).
- **Type consistency**: `QUALIFICATION_OPTIONS`/`QUALIFICATION_NONE`/`matchesQualification` are
  named identically between Task 1 (producer) and Task 2 (consumer). The `members` shape change
  (flat → nested `user`) is threaded consistently through both of Task 2's touched read sites
  (`pilots`, `groupStatusPilots`).
