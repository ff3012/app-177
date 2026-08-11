# Drohnengruppe Flugbuch-Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/drohnen` (Flugbuch) onto the Kalender-Desktop visual language (month groups,
color-stripe rows, sidebar filters) and open its admin view to Abschnitts-/Bezirksadmins, not just
the group's own admin; retire `/drohnen/90-tage` as a page in favor of an inline "Gruppenstatus"
card plus an Excel export.

**Architecture:** A new shared permission/query helper (`getAllowedDroneGroups`) replaces both the
existing inline `allowedGroups` logic in `admin/drohnen/page.tsx` and the old single-group
assumption in `/drohnen`, so both pages read the same list of reachable groups from one place. A
small set of new presentational components (status card, bar list, flight row/card) replace the
old ring/chart/table. The page itself is rebuilt to read filter state from the URL and query
Prisma server-side instead of the old client-side toggle-and-filter approach.

**Tech Stack:** Next.js App Router Server Components, Prisma, Tailwind (existing design tokens:
`success`/`warning`/`danger`/`brand`/`ink`/`surface`/`line` families, already used throughout
`/admin/drohnen` and the Kalender desktop view). No test framework exists in this repo —
verification happens via standalone `tsx` scripts against the local dev database and via
`tsc`/`next build`/manual dev-server checks, matching this repo's established practice.

## Global Constraints

- `NINETY_DAY_REQUIRED_FLIGHTS`/`getNinetyDayCutoff` from `src/lib/drone/ninety-day-rule.ts` are
  the only source of the "3 flights / 90 days" numbers — never hardcode `3` or `90` again anywhere
  in this feature.
- Admin-view audience for `/drohnen`, `/drohnen/export`, and the new 90-day export is the same as
  `canManageDroneGroupFor`: Bezirksadmin, Bezirks-Drohnenadmin, Abschnittsadmin of the group's
  anchor Abschnitt, or Admin of that specific group. This is a genuine widening from today's
  `isDroneGroupAdmin`-only rule — confirmed and approved by the app owner.
- Color tokens: GRÜN `success`/`success-subtle`/`success-text`, GELB/Bernstein
  `warning`/`warning-subtle`/`warning-text`, ROT-Chip `danger-subtle`/`danger` (exact existing
  Tailwind tokens, confirmed in `globals.css`) — the brief's own hex values for these three states
  (`#22a06b`/`#f0a92c`/`#e4322b`) already match `success`/`warning`/`brand` almost exactly; use the
  existing Tailwind classes, never new inline hex for these three.
  the existing Tailwind classes, never new inline hex for these three.
- The "Einsatz" stripe/border-left and the "Flug registrieren" primary action use the existing
  `brand` token (`#e4322b`, `border-brand`/`bg-brand`), not a new red.
- The "Übung" stripe color (`#c9c9ce`) and the "Alle"/"Meine" active-chip fill (`#1c1c1e`, i.e. the
  existing `ink` token) are the only two colors in this feature with no exact existing Tailwind
  utility class — define them once in a new `src/lib/drone/flight-colors.ts` (mirroring
  `src/lib/calendar/layer-colors.ts`'s precedent of one small named-constants file per feature)
  rather than repeating raw hex in multiple components.
- URL parameters on `/drohnen`: `gruppe`, `q`, `pilot`, `drohne`, `zeitraum`
  (`90tage`|`jahr`|`alle`, default `90tage`), `zweck` (`EINSATZ`|`UEBUNG`), `scope`
  (`ALLE`|`MEINE`, default `ALLE`), `take` (default `50`, increments by 50 via a "Weitere 50
  laden" link).
- No new dependency, no test framework, no changes to `DroneFlight`/`Drone`/`flight.schema.ts`/
  `createFlight`/`updateFlight`/`deleteFlight`'s core logic.

---

### Task 1: Foundation — shared group access, expiry math, month grouping

**Files:**
- Create: `src/lib/drone/flightbook-groups.ts`
- Create: `src/lib/drone/flight-colors.ts`
- Create: `src/lib/drone/group-flights-by-month.ts`
- Modify: `src/lib/drone/ninety-day-rule.ts` (add one function, keep everything else unchanged)
- Modify: `src/app/(app)/admin/drohnen/page.tsx:44-46` (replace the inline `allowedGroups`
  computation with the new shared helper — this is the ONLY change to this file in this task; do
  not touch anything else in it)

**Interfaces:**
- Consumes: `canManageDroneGroupFor`, `isBezirksAdmin` from `@/lib/auth/permissions` (both exist
  unchanged). `prisma` from `@/lib/db/prisma`. `NINETY_DAY_REQUIRED_FLIGHTS`,
  `getComplianceUntilDate` from `./ninety-day-rule` (both exist unchanged, read them before
  editing this file to confirm).
- Produces (used by Tasks 2-4):
  - `getAllowedDroneGroups(user: SessionUser): Promise<DroneGroup[]>` (full Prisma `DroneGroup`
    rows, ordered by `name: 'asc'`) — the one place "which groups can this user reach" is computed.
  - `getDaysUntilExpiry(flightDatesDesc: Date[]): number | null` in `ninety-day-rule.ts` — `null`
    if the rule isn't currently met (mirrors `getComplianceUntilDate`'s own null case), else the
    number of whole days from today until the compliance-until date.
  - `FLIGHT_COLORS = { einsatzStripe: '#e4322b', uebungStripe: '#c9c9ce', chipActiveBg: '#1c1c1e' }`
    from `flight-colors.ts` (a plain object, not Tailwind classes — used via inline `style` exactly
    where Tailwind has no matching utility, same pattern as `layer-colors.ts`'s `LAYER_COLORS`).
  - `groupFlightsByMonth<T extends { startsAt: Date }>(flights: T[]): { key: string; label:
    string; flights: T[] }[]` — generic so it works with whatever row shape Task 2/3 end up using,
    without a dependency on those later types.

- [ ] **Step 1: Read the two files you're extending, in full, before writing anything**

Read `src/lib/drone/ninety-day-rule.ts` and `src/app/(app)/admin/drohnen/page.tsx` in full. Confirm
`getComplianceUntilDate(flightDatesDesc: Date[]): Date | null` exists exactly as described above —
it does, at the time this plan was written, with this exact signature and this doc comment:

```typescript
/**
 * Bis wann die Regel ohne einen weiteren Flug erfüllt bleibt: die Regel bricht erst, sobald der
 * NINETY_DAY_REQUIRED_FLIGHTS-neueste (noch mitgezählte) Flug aus dem 90-Tage-Fenster fällt - also
 * 90 Tage nach dessen Datum. `flightDatesDesc` muss bereits auf das aktuelle Fenster gefiltert und
 * absteigend (neuester zuerst) sortiert sein. Gibt null zurück, wenn die Regel aktuell nicht erfüllt
 * ist (weniger als NINETY_DAY_REQUIRED_FLIGHTS Flüge im Fenster).
 */
export function getComplianceUntilDate(flightDatesDesc: Date[]): Date | null {
```

- [ ] **Step 2: Add `getDaysUntilExpiry` to `ninety-day-rule.ts`**

Add this function at the end of `src/lib/drone/ninety-day-rule.ts` (do not change anything else in
the file):

```typescript
/**
 * Tage bis zum Ablauf der 90-Tage-Regel (siehe getComplianceUntilDate), gerundet auf ganze Tage.
 * null, wenn die Regel aktuell nicht erfüllt ist - dieselbe Bedeutung wie getComplianceUntilDate's
 * eigener null-Fall, hier nur als Zahl statt als Datum, für die Bernstein-Schwelle in der neuen
 * Gruppenstatus-Balkenliste (<= 14 Tage = Bernstein statt Grün).
 */
export function getDaysUntilExpiry(flightDatesDesc: Date[]): number | null {
  const until = getComplianceUntilDate(flightDatesDesc);
  if (!until) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((until.getTime() - Date.now()) / msPerDay);
}
```

- [ ] **Step 3: Create `src/lib/drone/flightbook-groups.ts`**

```typescript
import { prisma } from '@/lib/db/prisma';
import { canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import type { SessionUser } from '@/types/next-auth';

/**
 * Alle Drohnengruppen, die dieser Benutzer als Admin verwalten darf: Bezirksadmin/Bezirks-
 * Drohnenadmin sehen alle, ein Abschnittsadmin nur die am eigenen Abschnitt verankerte, ein
 * reiner Gruppen-Admin nur die eigene. Geteilt zwischen /admin/drohnen und dem Flugbuch
 * (/drohnen, /drohnen/export, /drohnen/90-tage-export) - vorher gab es hiervon zwei unabhängige
 * Kopien (eine inline in admin/drohnen/page.tsx), was bei einer künftigen Rechteänderung hätte
 * auseinanderlaufen können. Ein leeres Array bedeutet "kein Admin-Zugriff auf irgendeine Gruppe",
 * nicht zwingend "kein Drohnengruppen-Zugriff überhaupt" (ein reines Mitglied hat hier immer []).
 */
export async function getAllowedDroneGroups(user: SessionUser) {
  const allGroups = await prisma.droneGroup.findMany({ orderBy: { name: 'asc' } });
  return isBezirksAdmin(user) ? allGroups : allGroups.filter((g) => canManageDroneGroupFor(user, g));
}
```

- [ ] **Step 4: Create `src/lib/drone/flight-colors.ts`**

```typescript
/**
 * Die einzigen zwei Farben dieses Moduls ohne exakt passenden Tailwind-Token (siehe
 * Global Constraints im Plan) - Einsatz-Streifen/"Flug registrieren" nutzen weiterhin die
 * bestehende brand-Klasse, Erfüllt/Bernstein/Offen weiterhin success/warning/danger. Gleiches
 * Muster wie src/lib/calendar/layer-colors.ts: eine kleine, benannte Konstanten-Datei statt
 * verstreuter Hex-Werte in mehreren Komponenten.
 */
export const FLIGHT_COLORS = {
  uebungStripe: '#c9c9ce',
  chipActiveBg: '#1c1c1e',
} as const;
```

- [ ] **Step 5: Create `src/lib/drone/group-flights-by-month.ts`**

```typescript
const MONTH_LABELS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export interface FlightMonthGroup<T> {
  key: string;
  label: string;
  flights: T[];
}

/**
 * flights muss bereits chronologisch sortiert sein (absteigend, neueste zuerst - wie die Flugbuch-
 * Query sie liefert) - hier nur noch nach Jahr+Monat in aufeinanderfolgende Gruppen zusammengefasst,
 * ohne erneut zu sortieren. Generisch über T (statt an einen konkreten FlightRow-Typ gebunden),
 * damit diese Datei keine Abhängigkeit auf Task 3's Zeilentyp braucht - nur `startsAt: Date` wird
 * vorausgesetzt. Ein Monat ohne Flüge taucht hier nie auf: die Funktion erzeugt Gruppen nur für
 * Monate, die tatsächlich mindestens einen der übergebenen (bereits gefilterten) Flüge enthalten.
 */
export function groupFlightsByMonth<T extends { startsAt: Date }>(flights: T[]): FlightMonthGroup<T>[] {
  const groups: FlightMonthGroup<T>[] = [];
  for (const flight of flights) {
    const key = `${flight.startsAt.getFullYear()}-${flight.startsAt.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.flights.push(flight);
    } else {
      groups.push({
        key,
        label: `${MONTH_LABELS[flight.startsAt.getMonth()]} ${flight.startsAt.getFullYear()}`,
        flights: [flight],
      });
    }
  }
  return groups;
}
```

- [ ] **Step 6: Update `admin/drohnen/page.tsx` to use the shared helper**

In `src/app/(app)/admin/drohnen/page.tsx`, replace:

```typescript
  const allGroups = await prisma.droneGroup.findMany({ orderBy: { name: 'asc' } });
  const allowedGroups = isBezirksAdmin(user) ? allGroups : allGroups.filter((g) => canManageDroneGroupFor(user, g));
```

with:

```typescript
  const allowedGroups = await getAllowedDroneGroups(user);
```

Add the import `import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';` near the
other `@/lib/drone/*` imports. Remove `isBezirksAdmin` from the `canManageDroneGroupFor, isBezirksAdmin`
import from `@/lib/auth/permissions` ONLY IF nothing else in that file still uses it directly — read
the rest of the file first; if `isBezirksAdmin` is still referenced elsewhere in that file, leave
the import as-is and only remove the two lines shown above.

- [ ] **Step 7: Verify with a standalone script**

Create `scripts/verify-flightbook-foundation.ts`:

```typescript
import { prisma } from '../src/lib/db/prisma';
import { getAllowedDroneGroups } from '../src/lib/drone/flightbook-groups';
import { getDaysUntilExpiry, NINETY_DAY_REQUIRED_FLIGHTS } from '../src/lib/drone/ninety-day-rule';
import { groupFlightsByMonth } from '../src/lib/drone/group-flights-by-month';

async function main() {
  // getDaysUntilExpiry: not met -> null
  console.log('not met -> null:', getDaysUntilExpiry([]) === null ? 'OK' : 'FAIL');

  // getDaysUntilExpiry: met, oldest counted flight was exactly 80 days ago (90-80=10 days left)
  const dates: Date[] = [];
  for (let i = 0; i < NINETY_DAY_REQUIRED_FLIGHTS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (i === NINETY_DAY_REQUIRED_FLIGHTS - 1 ? 80 : 1));
    dates.push(d);
  }
  const days = getDaysUntilExpiry(dates);
  console.log(`met, ~10 days left -> got ${days}:`, days !== null && days >= 9 && days <= 11 ? 'OK' : 'FAIL');

  // groupFlightsByMonth: consecutive same-month flights merge, different months split, order preserved
  const flights = [
    { id: 'a', startsAt: new Date('2026-07-28') },
    { id: 'b', startsAt: new Date('2026-07-14') },
    { id: 'c', startsAt: new Date('2026-06-21') },
  ];
  const groups = groupFlightsByMonth(flights);
  console.log('group count === 2:', groups.length === 2 ? 'OK' : 'FAIL');
  console.log('first group has 2 flights:', groups[0].flights.length === 2 ? 'OK' : 'FAIL');
  console.log('first group label:', groups[0].label === 'Juli 2026' ? 'OK' : `FAIL (${groups[0].label})`);
  console.log('second group label:', groups[1].label === 'Juni 2026' ? 'OK' : `FAIL (${groups[1].label})`);

  // getAllowedDroneGroups: real DB call doesn't throw, returns an array
  const allGroups = await prisma.droneGroup.findMany({ orderBy: { name: 'asc' } });
  if (allGroups.length === 0) {
    console.log('no DroneGroup rows in this dev DB - skipping getAllowedDroneGroups live check');
  } else {
    // Build a synthetic Bezirksadmin SessionUser shape - only the fields getAllowedDroneGroups/
    // its dependencies actually read.
    const fakeBezirksAdmin = {
      id: 'x', isBezirksAdmin: true, isBezirksDrohnenAdmin: false, abschnittAdminOrgIds: [],
      droneGroupRole: null, droneGroupId: null,
    } as unknown as Parameters<typeof getAllowedDroneGroups>[0];
    const result = await getAllowedDroneGroups(fakeBezirksAdmin);
    console.log(`Bezirksadmin sees all ${allGroups.length} groups:`, result.length === allGroups.length ? 'OK' : 'FAIL');
  }
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 8: Run the verification script**

Run: `npx tsx scripts/verify-flightbook-foundation.ts`
Expected: every line prints `OK`, no `FAIL`.

- [ ] **Step 9: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors (this also confirms Step 6's edit to `admin/drohnen/page.tsx` didn't break
anything).

- [ ] **Step 10: Delete the temporary script and commit**

```bash
rm scripts/verify-flightbook-foundation.ts
git add src/lib/drone/flightbook-groups.ts src/lib/drone/flight-colors.ts src/lib/drone/group-flights-by-month.ts src/lib/drone/ninety-day-rule.ts "src/app/(app)/admin/drohnen/page.tsx"
git commit -m "Drohnengruppe: geteilte Gruppen-Zugriffsfunktion, Ablauf-Berechnung, Monatsgruppierung"
```

---

### Task 2: Presentational components — status card, bar list, flight row/card, badge recolor

**Files:**
- Modify: `src/components/drone/purpose-badge.tsx` (full rewrite of the color logic, same props)
- Create: `src/components/drone/mein-status-card.tsx`
- Create: `src/components/drone/group-status-list.tsx`
- Create: `src/components/drone/flight-row.tsx`
- Delete: `src/components/drone/ninety-day-ring.tsx` (fully superseded by `MeinStatusCard`)
- Delete: `src/components/drone/group-status-chart.tsx` (fully superseded by `GroupStatusList`)

**Interfaces:**
- Consumes: `FLIGHT_COLORS` from Task 1's `@/lib/drone/flight-colors`. Existing
  `NINETY_DAY_REQUIRED_FLIGHTS` from `@/lib/drone/ninety-day-rule` (import in the pages that use
  these components, not needed inside the components themselves — they take `required: number` as
  a prop, same as the old `NinetyDayRing` did).
- Produces (used by Task 3):
  - `PurposeBadge({ label }: { label: string })` — same signature as today, new colors only.
  - `MeinStatusCard({ count, required, met, complianceUntilLabel, lastFlightAgoLabel }: { count:
    number; required: number; met: boolean; complianceUntilLabel: string | null;
    lastFlightAgoLabel: string | null })` — same prop shape as the old `NinetyDayRingProps`
    (deliberately unchanged, so Task 3 can swap the import with zero prop changes at call sites).
  - `GroupStatusPilot` type and `GroupStatusList({ pilots, groupName }: { pilots:
    GroupStatusPilot[]; groupName: string })`.
  - `FlightRowData` type and `FlightRow({ flight }: { flight: FlightRowData })` (desktop row,
    `hidden sm:flex`) and `FlightCard({ flight }: { flight: FlightRowData })` (mobile card,
    `sm:hidden`) — both exported from `flight-row.tsx`.

- [ ] **Step 1: Rewrite `src/components/drone/purpose-badge.tsx`**

```typescript
/** Einsatz nutzt jetzt dieselben danger-Tokens wie andere Status-Chips in dieser Codebase (z. B.
 * die Atemschutz-/Fahrzeug-Reservierungs-Badges) statt der vorherigen vollflächigen brand-Füllung -
 * Vollrot (brand) ist seit diesem Redesign dem Farbstreifen und der "Flug registrieren"-Aktion
 * vorbehalten, nicht mehr dem Chip selbst (Drohnengruppe-Brief.md §6). Übung nutzt surface-sunken
 * statt eines Outline-Rahmens, um optisch näher an den Kalender-Zweck-Chips zu liegen. */
export function PurposeBadge({ label }: { label: string }) {
  const isEinsatz = label === 'Einsatz';
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
        isEinsatz ? 'bg-danger-subtle text-danger' : 'bg-surface-sunken text-ink-muted'
      }`}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Create `src/components/drone/mein-status-card.tsx`**

```typescript
interface MeinStatusCardProps {
  count: number;
  required: number;
  met: boolean;
  complianceUntilLabel: string | null;
  lastFlightAgoLabel: string | null;
}

/**
 * Ersetzt NinetyDayRing (SVG-Fortschrittsring) durch einen dreiteiligen Segment-Balken, wie im
 * Drohnengruppe-Brief.md §4.1 gefordert - dieselben Props wie NinetyDayRing, damit die Ablösung an
 * den Aufrufstellen ein reiner Import-Tausch ist. Die drei Segmente sind immer genau
 * NINETY_DAY_REQUIRED_FLIGHTS Stück (required), unabhängig von count - jedes Segment bis
 * einschließlich count ist grün gefüllt, der Rest grau (bg-surface-sunken), auch wenn count >
 * required (dann sind einfach alle Segmente grün, keine vierte Zelle für den Überschuss).
 */
export function MeinStatusCard({ count, required, met, complianceUntilLabel, lastFlightAgoLabel }: MeinStatusCardProps) {
  const segments = Array.from({ length: required }, (_, i) => i < count);

  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Mein Status</div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className={`font-condensed text-3xl font-bold ${met ? 'text-success-text' : 'text-danger'}`}>{count}</span>
        <span className="text-sm text-ink-muted">
          von {required} Flügen
          <br />
          in 90 Tagen
        </span>
      </div>
      <div className="mb-3 flex gap-1">
        {segments.map((filled, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${filled ? 'bg-success' : 'bg-surface-sunken'}`} />
        ))}
      </div>
      <div className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${met ? 'bg-success-subtle' : 'bg-danger-subtle'}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${met ? 'bg-success' : 'bg-danger'}`} />
        <span className={`text-sm font-medium ${met ? 'text-success-text' : 'text-danger'}`}>
          {met ? (complianceUntilLabel ? `Erfüllt · letzter Flug ${lastFlightAgoLabel ?? ''}` : 'Erfüllt') : 'Nicht erfüllt'}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/drone/group-status-list.tsx`**

```typescript
export interface GroupStatusPilot {
  id: string;
  name: string;
  count: number;
  status: 'success' | 'warning' | 'danger';
}

const BAR_CLASS: Record<GroupStatusPilot['status'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const COUNT_TEXT_CLASS: Record<GroupStatusPilot['status'], string> = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger',
};

/**
 * Ersetzt GroupStatusChart (Säulendiagramm mit abgeschnittenen Namen bei mehr als ~6 Mitgliedern,
 * siehe dessen eigener Kommentar) durch eine waagrechte Balkenliste mit vollem Namen links -
 * skaliert unabhängig von der Mitgliederzahl, siehe Drohnengruppe-Brief.md §5/§9 ("bei 21 Piloten
 * bleibt die Liste lesbar"). `status` kommt bereits fertig klassifiziert von der aufrufenden Seite
 * (siehe Task 3) - diese Komponente trifft selbst keine Ampel-Entscheidung, nur Darstellung.
 */
export function GroupStatusList({ pilots, groupName }: { pilots: GroupStatusPilot[]; groupName: string }) {
  const metCount = pilots.filter((p) => p.status !== 'danger').length;
  const maxCount = Math.max(1, ...pilots.map((p) => p.count));

  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <span className="text-[15px] font-semibold text-ink">Gruppenstatus · 90-Tage-Regel · {groupName}</span>
        <span className="text-sm text-ink-muted">
          {metCount} von {pilots.length} erfüllt
        </span>
      </div>

      {pilots.length === 0 ? (
        <p className="text-sm text-ink-muted">Keine Mitglieder dieser Drohnengruppe hinterlegt.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {pilots.map((pilot) => (
            <div key={pilot.id} className="flex items-center gap-3">
              <span className="w-[132px] shrink-0 truncate text-sm font-medium text-ink">{pilot.name}</span>
              <span className="h-[22px] flex-1 overflow-hidden rounded bg-surface-sunken">
                <span
                  className={`block h-full ${BAR_CLASS[pilot.status]}`}
                  style={{ width: `${Math.max(4, (pilot.count / maxCount) * 100)}%` }}
                />
              </span>
              <span className={`w-[46px] shrink-0 text-right text-sm font-semibold ${COUNT_TEXT_CLASS[pilot.status]}`}>
                {pilot.count}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3.5 border-t border-line pt-3 text-xs text-ink-faint">
        Drei Flüge innerhalb von 90 Tagen sind erforderlich. Bernstein bedeutet: erfüllt, aber ein Flug fällt
        demnächst aus dem Fenster.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/drone/flight-row.tsx`**

```typescript
import Link from 'next/link';
import { PurposeBadge } from './purpose-badge';
import { FLIGHT_COLORS } from '@/lib/drone/flight-colors';

export interface FlightRowData {
  id: string;
  dayNumber: string;
  weekdayLabel: string;
  location: string;
  timeLabel: string;
  pilotName: string;
  droneName: string;
  purposeLabel: string;
  originLabel: string;
  editable: boolean;
}

function stripeColor(purposeLabel: string): string {
  return purposeLabel === 'Einsatz' ? '#e4322b' : FLIGHT_COLORS.uebungStripe;
}

/** Desktop-Zeile (>= sm:), ein Baustein einer Monatsgruppen-Karte. Ganze Zeile klickbar, öffnet
 * für editierbare Flüge direkt das Bearbeiten-Formular (Flüge haben keine Detail-Zwischenseite wie
 * Kalender-Termine, also kein Einzel-vs-Doppelklick-Unterschied nötig - ein einfacher Link genügt). */
export function FlightRow({ flight }: { flight: FlightRowData }) {
  const content = (
    <div className="flex items-center gap-[18px] py-3.5 pr-5">
      <div className="w-[62px] shrink-0 text-center">
        <div className="font-condensed text-2xl font-bold leading-none text-ink">{flight.dayNumber}</div>
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{flight.weekdayLabel}</div>
      </div>
      <div className="min-w-[120px] flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[17px] font-semibold text-ink">{flight.location}</span>
          <PurposeBadge label={flight.purposeLabel} />
        </div>
        <div className="text-sm text-ink-muted">
          {flight.timeLabel} · {flight.pilotName} · {flight.droneName}
        </div>
      </div>
      <div className="w-[168px] shrink-0 text-xs text-ink-faint">{flight.originLabel}</div>
      <div className="flex w-[116px] shrink-0 justify-end">
        <span className="rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink-muted">
          {flight.editable ? 'Bearbeiten' : 'Öffnen'}
        </span>
      </div>
    </div>
  );

  return (
    <Link
      href={flight.editable ? `/drohnen/${flight.id}/bearbeiten` : '#'}
      className="hidden border-b border-line pl-0 last:border-0 hover:bg-surface-sunken sm:flex"
      style={{ borderLeft: `5px solid ${stripeColor(flight.purposeLabel)}` }}
      aria-disabled={!flight.editable}
      onClick={(e) => {
        if (!flight.editable) e.preventDefault();
      }}
    >
      {content}
    </Link>
  );
}

/** Mobile-Karte (< sm:), gleicher Dateninhalt wie FlightRow, vertikal gestapelt - Fortsetzung des
 * bestehenden FlightCard-Konzepts aus dem alten flight-table.tsx, an die neuen Datenfelder
 * (originLabel statt "Erfasst von {Name}", neues PurposeBadge-Farbschema) angepasst. */
export function FlightCard({ flight }: { flight: FlightRowData }) {
  const content = (
    <div className="flex flex-col gap-1 py-3 pl-3 pr-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">
          {flight.dayNumber}. {flight.weekdayLabel} · {flight.timeLabel}
        </span>
        {flight.editable && <span className="shrink-0 text-xs font-medium text-brand">Bearbeiten ›</span>}
      </div>
      <span className="text-sm text-ink">{flight.location}</span>
      <span className="text-sm text-ink-muted">
        {flight.pilotName} · {flight.droneName}
      </span>
      <span>
        <PurposeBadge label={flight.purposeLabel} />
      </span>
      <span className="text-xs text-ink-faint">{flight.originLabel}</span>
    </div>
  );

  return (
    <div className="border-b border-line last:border-0 sm:hidden" style={{ borderLeft: `4px solid ${stripeColor(flight.purposeLabel)}` }}>
      {flight.editable ? (
        <Link href={`/drohnen/${flight.id}/bearbeiten`} className="block active:bg-surface-sunken">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}
```

- [ ] **Step 5: Delete the two superseded components**

```bash
rm src/components/drone/ninety-day-ring.tsx src/components/drone/group-status-chart.tsx
```

- [ ] **Step 6: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/app/(app)/drohnen/page.tsx` (still importing the two deleted
components — that file is rewritten in Task 3, so this is expected and fine at this point). If
there are errors anywhere else, stop and investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/components/drone/purpose-badge.tsx src/components/drone/mein-status-card.tsx src/components/drone/group-status-list.tsx src/components/drone/flight-row.tsx
git rm src/components/drone/ninety-day-ring.tsx src/components/drone/group-status-chart.tsx
git commit -m "Drohnengruppe: neue Ampel-Komponenten (Mein-Status-Karte, Gruppenstatus-Balkenliste, Flug-Zeile)"
```

---

### Task 3: `/drohnen` page rewrite — the full integration

**Files:**
- Modify (full rewrite): `src/app/(app)/drohnen/page.tsx`
- Modify: `src/lib/drone/quick-register-user.ts` (export one new helper, no other changes)
- Delete: `src/components/drone/flight-table.tsx` (fully superseded — its table/card rendering
  moves into Task 2's `FlightRow`/`FlightCard`, and its client-side toggle moves into this page's
  server-side `scope` URL param)
- Create: `src/app/(app)/drohnen/loading.tsx`
- Create: `src/components/drone/flight-sidebar.tsx` (the filter sidebar, `'use client'` only where
  it needs `useRouter`/`usePathname`/`useSearchParams` for the Select/Chip navigation — the
  "Mein Status"/"Meine Gruppe"/"Schnellerfassung" cards are plain server-renderable JSX passed in
  as children/props, not part of this client component, to keep the client bundle small)

**Interfaces:**
- Consumes: `getAllowedDroneGroups` (Task 1), `groupFlightsByMonth` (Task 1), `getDaysUntilExpiry`
  (Task 1), `MeinStatusCard` (Task 2), `GroupStatusList`/`GroupStatusPilot` (Task 2),
  `FlightRow`/`FlightCard`/`FlightRowData` (Task 2). Existing, unchanged: `requireUser`,
  `canManageFlight`, `canRegisterFlight`, `canViewDroneModule`, `listDrohnengruppeMembers`,
  `NINETY_DAY_REQUIRED_FLIGHTS`, `getNinetyDayCutoff`, `meetsNinetyDayRule`.
- Produces: nothing consumed by later tasks — Task 4 only needs to know the route stays `/drohnen`
  with the `?gruppe=` param name already fixed by Task 1/this task.

- [ ] **Step 1: Delete the superseded flight-table component and add the QR-origin helper**

```bash
rm src/components/drone/flight-table.tsx
```

In `src/lib/drone/quick-register-user.ts`, add this exported function right after
`QUICK_REGISTER_EMAIL`'s declaration (do not change anything else in the file):

```typescript
/** Ob eine erfasste Flug-E-Mail dem technischen QR-Schnellerfassungs-Platzhalter gehört, für die
 * "Erfasst über Schnellerfassung (QR)"-Herkunftsbeschriftung im Flugbuch (Drohnengruppe-Brief.md
 * §6) - der einzige Konsument außerhalb dieser Datei, der wissen muss, wann ein registeredBy
 * dieser technische Platzhalter statt eine echte Person ist. */
export function isQuickRegisterEmail(email: string): boolean {
  return email === QUICK_REGISTER_EMAIL;
}
```

- [ ] **Step 2: Create the filter sidebar client component `src/components/drone/flight-sidebar.tsx`**

```typescript
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

export interface FlightFilterOptions {
  pilots: { id: string; name: string }[];
  drones: { id: string; name: string }[];
  totalCount: number;
  meineCount: number;
  fuerAndereErfasstCount: number;
  isAdmin: boolean;
}

const ZEITRAUM_LABEL: Record<string, string> = {
  '90tage': 'Letzte 90 Tage',
  jahr: 'Dieses Jahr',
  alle: 'Alle',
};

/**
 * Reine URL-Navigation, kein eigener Zustand: jede Änderung ersetzt den entsprechenden Query-
 * Parameter und lässt alle anderen (inkl. gruppe/take) unangetastet, damit "Filterzustand übersteht
 * Reload und ist als Link teilbar" (Brief-Abnahme) für jede einzelne Kombination gilt. `scope`
 * (ALLE/MEINE) wird sowohl vom "Meine"-Chip als auch vom "Alle Flüge einsehen"-Umschalter
 * geschrieben/gelesen - ein einziger Wahrheits-Zustand, zwei Bedienelemente (siehe Plan-Spec §3).
 */
export function FlightSidebar({ pilots, drones, totalCount, meineCount, fuerAndereErfasstCount, isAdmin }: FlightFilterOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const scope = searchParams.get('scope') === 'MEINE' ? 'MEINE' : 'ALLE';
  const zweck = searchParams.get('zweck') ?? '';
  const pilot = searchParams.get('pilot') ?? '';
  const drohne = searchParams.get('drohne') ?? '';
  const zeitraum = searchParams.get('zeitraum') ?? '90tage';

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('take');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-lg bg-surface p-4 shadow-card">
      <span className="text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Nur anzeigen</span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setParam('scope', '')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            scope === 'ALLE' && !zweck ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          Alle {totalCount}
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setParam('scope', 'MEINE')}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              scope === 'MEINE' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
            }`}
          >
            Meine {meineCount}
          </button>
        ) : (
          fuerAndereErfasstCount > 0 && (
            <span className="rounded-full bg-surface-sunken px-3 py-1.5 text-xs font-semibold text-ink-muted">
              Für andere erfasst {fuerAndereErfasstCount}
            </span>
          )
        )}
        <button
          type="button"
          onClick={() => setParam('zweck', zweck === 'EINSATZ' ? '' : 'EINSATZ')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            zweck === 'EINSATZ' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          Einsatz
        </button>
        <button
          type="button"
          onClick={() => setParam('zweck', zweck === 'UEBUNG' ? '' : 'UEBUNG')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            zweck === 'UEBUNG' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          Übung
        </button>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
        {isAdmin && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">Pilot</span>
            <select
              value={pilot}
              onChange={(e) => setParam('pilot', e.target.value)}
              className="h-[38px] rounded-md border border-line bg-surface px-2.5 text-ink"
            >
              <option value="">Alle {pilots.length}</option>
              {pilots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">Drohne</span>
          <select
            value={drohne}
            onChange={(e) => setParam('drohne', e.target.value)}
            className="h-[38px] rounded-md border border-line bg-surface px-2.5 text-ink"
          >
            <option value="">Alle {drones.length}</option>
            {drones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">Zeitraum</span>
          <select
            value={zeitraum}
            onChange={(e) => setParam('zeitraum', e.target.value)}
            className="h-[38px] rounded-md border border-line bg-surface px-2.5 text-ink"
          >
            {Object.entries(ZEITRAUM_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Zweck</span>
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className="h-3.5 w-6 shrink-0 rounded bg-danger-subtle" /> Einsatz
        </span>
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className="h-3.5 w-6 shrink-0 rounded bg-surface-sunken" /> Übung
        </span>
      </div>

      {isAdmin && (
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
          <div>
            <div className="text-sm font-medium text-ink">Alle Flüge einsehen</div>
            <div className="text-xs text-ink-faint">Admin-Ansicht</div>
          </div>
          <ToggleSwitch label="" checked={scope === 'ALLE'} onChange={(checked) => setParam('scope', checked ? '' : 'MEINE')} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/(app)/drohnen/page.tsx` in full**

```typescript
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageFlight, canRegisterFlight, canViewDroneModule } from '@/lib/auth/permissions';
import {
  NINETY_DAY_REQUIRED_FLIGHTS,
  getComplianceUntilDate,
  getDaysUntilExpiry,
  getNinetyDayCutoff,
  meetsNinetyDayRule,
} from '@/lib/drone/ninety-day-rule';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { groupFlightsByMonth } from '@/lib/drone/group-flights-by-month';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { isQuickRegisterEmail } from '@/lib/drone/quick-register-user';
import { MeinStatusCard } from '@/components/drone/mein-status-card';
import { GroupStatusList, type GroupStatusPilot } from '@/components/drone/group-status-list';
import { FlightRow, FlightCard, type FlightRowData } from '@/components/drone/flight-row';
import { FlightSidebar } from '@/components/drone/flight-sidebar';

const PURPOSE_LABEL: Record<string, string> = { UEBUNG: 'Übung', EINSATZ: 'Einsatz' };
const PAGE_SIZE = 50;

function formatDaysAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'heute';
  if (days === 1) return 'vor 1 Tag';
  return `vor ${days} Tagen`;
}

function zeitraumCutoff(zeitraum: string): Date | null {
  if (zeitraum === 'jahr') {
    const d = new Date();
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (zeitraum === 'alle') return null;
  return getNinetyDayCutoff();
}

export default async function DrohnenPage({
  searchParams,
}: {
  searchParams: Promise<{
    gruppe?: string;
    q?: string;
    pilot?: string;
    drohne?: string;
    zeitraum?: string;
    zweck?: string;
    scope?: string;
    take?: string;
  }>;
}) {
  const user = await requireUser();

  if (!canViewDroneModule(user)) {
    return <p className="text-ink-muted">Dieser Bereich ist nur für Mitglieder der Drohnengruppe sichtbar.</p>;
  }

  const params = await searchParams;
  const allowedGroups = await getAllowedDroneGroups(user);
  const isAdmin = allowedGroups.length > 0;

  // Ein reines Mitglied ohne Admin-Recht bleibt weiterhin an die eigene Gruppe gebunden - das
  // Flugbuch war und bleibt für Mitglieder single-group, nur Admins bekommen den Gruppenwechsel.
  // Für Admins liefert allowedGroups bereits volle DroneGroup-Zeilen (inkl. name) - keine zweite
  // Abfrage nötig; nur das Mitglied ohne eigenen Eintrag in allowedGroups braucht einen direkten
  // Lookup seiner einen Gruppe.
  const selectedGroup = isAdmin
    ? (params.gruppe && allowedGroups.find((g) => g.id === params.gruppe)) || allowedGroups[0]
    : await prisma.droneGroup.findUniqueOrThrow({ where: { id: user.droneGroupId! }, select: { id: true, name: true } });

  const cutoff = zeitraumCutoff(params.zeitraum ?? '90tage');
  const scope = params.scope === 'MEINE' ? 'MEINE' : 'ALLE';
  const take = Math.max(PAGE_SIZE, Number(params.take) || PAGE_SIZE);

  const baseWhere = isAdmin
    ? { drone: { droneGroupId: selectedGroup.id } }
    : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] };

  const scopeWhere =
    isAdmin && scope === 'MEINE' ? { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] } : {};

  const filterWhere = {
    ...(params.pilot ? { pilotUserId: params.pilot } : {}),
    ...(params.drohne ? { droneId: params.drohne } : {}),
    ...(params.zweck ? { purpose: params.zweck as 'EINSATZ' | 'UEBUNG' } : {}),
    ...(cutoff ? { startsAt: { gte: cutoff } } : {}),
    ...(params.q ? { location: { contains: params.q, mode: 'insensitive' as const } } : {}),
  };

  const where = { AND: [baseWhere, scopeWhere, filterWhere] };

  const [flights, totalCount, meineCount, fuerAndereErfasstCount, ownFlightsInWindow, lastOwnFlight, members, groupCounts, drones] =
    await Promise.all([
      prisma.droneFlight.findMany({
        where,
        include: { drone: true, registeredBy: true, pilotUser: true },
        orderBy: { startsAt: 'desc' },
        take,
      }),
      prisma.droneFlight.count({ where }),
      isAdmin
        ? prisma.droneFlight.count({
            where: { AND: [{ drone: { droneGroupId: selectedGroup.id } }, { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] }, filterWhere] },
          })
        : Promise.resolve(0),
      !isAdmin
        ? prisma.droneFlight.count({
            where: { AND: [baseWhere, { registeredById: user.id, NOT: { pilotUserId: user.id } }, filterWhere] },
          })
        : Promise.resolve(0),
      prisma.droneFlight.findMany({
        where: { pilotUserId: user.id, startsAt: { gte: getNinetyDayCutoff() } },
        orderBy: { startsAt: 'desc' },
        select: { startsAt: true },
      }),
      prisma.droneFlight.findFirst({ where: { pilotUserId: user.id }, orderBy: { startsAt: 'desc' }, select: { startsAt: true } }),
      // Ein Aufruf, zweifach genutzt: als Gruppenstatus-Mitgliederliste UND als Pilot-Filter-
      // Optionen (beide brauchten vorher zwei identische listDrohnengruppeMembers-Aufrufe).
      isAdmin ? listDrohnengruppeMembers(selectedGroup.id) : Promise.resolve([]),
      isAdmin
        ? prisma.droneFlight.groupBy({
            by: ['pilotUserId'],
            where: { startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId: selectedGroup.id } } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      isAdmin
        ? prisma.drone.findMany({ where: { droneGroupId: selectedGroup.id, isActive: true }, orderBy: { sortOrder: 'asc' } })
        : Promise.resolve([]),
    ]);
  const pilots = members;
  const groupMembers = members;

  const ownFlightCount = ownFlightsInWindow.length;
  const ownRuleMet = meetsNinetyDayRule(ownFlightCount);
  const complianceUntil = getComplianceUntilDate(ownFlightsInWindow.map((f) => f.startsAt));

  const countByPilot = new Map(groupCounts.map((c) => [c.pilotUserId, c._count._all]));
  const groupStatusPilots: GroupStatusPilot[] = groupMembers.map((member) => {
    const count = countByPilot.get(member.id) ?? 0;
    const met = meetsNinetyDayRule(count);
    const daysLeft = met ? getDaysUntilExpiry(ownFlightsInWindow.map((f) => f.startsAt)) : null;
    const status: GroupStatusPilot['status'] = !met ? 'danger' : daysLeft !== null && daysLeft <= 14 ? 'warning' : 'success';
    return { id: member.id, name: `${member.lastName} ${member.firstName}`, count, status };
  });

  const flightRows: FlightRowData[] = flights.map((flight) => {
    const purposeLabel = PURPOSE_LABEL[flight.purpose] ?? flight.purpose;
    const isForOthers = !isAdmin && flight.registeredById === user.id && flight.pilotUserId !== user.id;
    const originLabel = isQuickRegisterEmail(flight.registeredBy.email)
      ? 'Erfasst über Schnellerfassung (QR)'
      : isForOthers
        ? `Für andere erfasst / von ${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`
        : `Erfasst von ${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`;
    return {
      id: flight.id,
      dayNumber: String(flight.startsAt.getDate()).padStart(2, '0'),
      weekdayLabel: flight.startsAt.toLocaleDateString('de-AT', { weekday: 'short' }),
      location: flight.location,
      timeLabel: flight.startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }),
      pilotName: `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`,
      droneName: flight.drone.name,
      purposeLabel,
      originLabel,
      editable: canManageFlight(user, { registeredById: flight.registeredById, droneGroupId: flight.drone.droneGroupId }),
    };
  });

  const monthGroups = groupFlightsByMonth(flights.map((f) => ({ ...f, __row: flightRows.find((r) => r.id === f.id)! })));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-ink">{isAdmin ? 'Flugbuch Drohnengruppen' : 'Meine Flüge'}</h1>
          <p className="text-[15px] text-ink-muted">
            {isAdmin ? `${selectedGroup.name} · ${groupStatusPilots.length} Piloten · ${totalCount} Flüge` : `${selectedGroup.name} · ${user.name}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/drohnen/unterlagen" className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken">
            Unterlagen
          </Link>
          {isAdmin && (
            <>
              <a href={`/drohnen/90-tage-export?gruppe=${selectedGroup.id}`} className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken">
                90-Tage-Report
              </a>
              <a href={`/drohnen/export?gruppe=${selectedGroup.id}`} className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken">
                Export
              </a>
            </>
          )}
          {canRegisterFlight(user) && (
            <Link href="/drohnen/neu" className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
              Flug registrieren
            </Link>
          )}
        </div>
      </div>

      {isAdmin && allowedGroups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {allowedGroups.map((g) => (
            <Link
              key={g.id}
              href={`/drohnen?gruppe=${g.id}`}
              className={`rounded-full px-3.5 py-2 text-sm font-semibold ${g.id === selectedGroup.id ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'}`}
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3.5 lg:w-[250px] lg:shrink-0">
          <MeinStatusCard
            count={ownFlightCount}
            required={NINETY_DAY_REQUIRED_FLIGHTS}
            met={ownRuleMet}
            complianceUntilLabel={complianceUntil ? complianceUntil.toLocaleDateString('de-AT') : null}
            lastFlightAgoLabel={lastOwnFlight ? formatDaysAgo(lastOwnFlight.startsAt) : null}
          />
          <FlightSidebar
            pilots={pilots.map((p) => ({ id: p.id, name: `${p.lastName} ${p.firstName}` }))}
            drones={drones.map((d) => ({ id: d.id, name: d.name }))}
            totalCount={totalCount}
            meineCount={meineCount}
            fuerAndereErfasstCount={fuerAndereErfasstCount}
            isAdmin={isAdmin}
          />
          {!isAdmin && (
            <div className="rounded-lg bg-surface p-4 shadow-card">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Meine Gruppe</div>
              <div className="mb-1 text-[15px] font-semibold text-ink">{selectedGroup.name}</div>
              <p className="text-sm text-ink-muted">
                Sie sehen Ihre eigenen Flüge sowie Flüge, die Sie für andere erfasst haben. Der Gruppenstand ist den
                Drohnen-Admins vorbehalten.
              </p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {isAdmin && <GroupStatusList pilots={groupStatusPilots} groupName={selectedGroup.name} />}

          <p className="text-[15px] text-ink-muted">{totalCount} Flüge</p>

          {flights.length === 0 ? (
            <div className="rounded-lg bg-surface p-6 text-center text-sm shadow-card">
              {params.pilot || params.drohne || params.zweck || params.q ? (
                <>
                  <p className="mb-2 text-ink-muted">Keine Flüge für diese Filter.</p>
                  <Link href={`/drohnen?gruppe=${selectedGroup.id}`} className="text-brand hover:underline">
                    Filter zurücksetzen
                  </Link>
                </>
              ) : (
                <>
                  <p className="mb-3 text-ink-muted">Noch keine Flüge erfasst.</p>
                  {canRegisterFlight(user) && (
                    <Link href="/drohnen/neu" className="inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
                      Flug registrieren
                    </Link>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {monthGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">{group.label}</div>
                  <div className="flex flex-col rounded-lg bg-surface shadow-card sm:block">
                    {group.flights.map((f) => (
                      <div key={f.id}>
                        <FlightRow flight={(f as unknown as { __row: FlightRowData }).__row} />
                        <FlightCard flight={(f as unknown as { __row: FlightRowData }).__row} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {flights.length < totalCount && (
                <Link
                  href={`/drohnen?${new URLSearchParams({ ...params, take: String(take + PAGE_SIZE) } as Record<string, string>).toString()}`}
                  className="self-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken"
                >
                  Weitere {Math.min(PAGE_SIZE, totalCount - flights.length)} laden
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/drohnen/loading.tsx`**

```typescript
import { Skeleton } from '@/components/ui/skeleton';

/** Sechs Skeleton-Zeilen in Listenform, kein Spinner - gleiches Muster wie
 * admin/benutzer/loading.tsx, hier auf das Flugbuch-Layout (Kopfbereich + Sidebar + Liste)
 * angepasst. */
export default function DrohnenLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3.5 lg:w-[250px] lg:shrink-0">
          <Skeleton className="h-[160px] w-full rounded-lg" />
          <Skeleton className="h-[280px] w-full rounded-lg" />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[64px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the repo now (this is the task that removes the last references to
the deleted `flight-table.tsx`/`ninety-day-ring.tsx`/`group-status-chart.tsx`).

- [ ] **Step 6: Manual verification against the local dev server**

Run `npm run dev`. As a plain Drohnengruppe member: confirm `/drohnen` shows "Meine Flüge", no
group-chip row, no Gruppenstatus card, correct own-flight filtering. As a seeded Bezirksadmin (or
temporarily grant yourself `droneGroupRole: 'ADMIN'` on one group via the dev DB if no admin
account is seeded): confirm the group-chip row appears when >1 group is reachable, switching groups
updates the URL and the list/status card, filters persist across a reload, "Weitere laden" appends
without losing filters, and a month with zero matching flights doesn't render an empty card.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/drohnen/page.tsx" "src/app/(app)/drohnen/loading.tsx" src/components/drone/flight-sidebar.tsx
git rm src/components/drone/flight-table.tsx
git commit -m "Drohnengruppe: Flugbuch-Seite auf Kalender-Bausteine umgestellt"
```

---

### Task 4: Export routes and old-page removal

**Files:**
- Modify: `src/app/(app)/drohnen/export/route.ts` (add `?gruppe=` support)
- Create: `src/app/(app)/drohnen/90-tage-export/route.ts`
- Delete: `src/app/(app)/drohnen/90-tage/page.tsx` (and the now-empty `90-tage/` directory)

**Interfaces:**
- Consumes: `getAllowedDroneGroups` (Task 1), `NINETY_DAY_REQUIRED_FLIGHTS`/`getNinetyDayCutoff`/
  `meetsNinetyDayRule` (existing, unchanged), `listDrohnengruppeMembers` (existing, unchanged).
- Produces: nothing — this is the last task in the plan.

- [ ] **Step 1: Update `src/app/(app)/drohnen/export/route.ts` to accept `?gruppe=`**

Replace the whole file with:

```typescript
import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const allowedGroups = await getAllowedDroneGroups(user);
  if (allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const requestedGroupId = request.nextUrl.searchParams.get('gruppe');
  const droneGroupId = (requestedGroupId && allowedGroups.find((g) => g.id === requestedGroupId)?.id) || allowedGroups[0].id;

  const flights = await prisma.droneFlight.findMany({
    where: { drone: { droneGroupId } },
    include: { drone: true, registeredBy: true, pilotUser: true },
    orderBy: { startsAt: 'desc' },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Drohnenflüge');
  sheet.columns = [
    { header: 'Datum/Uhrzeit', key: 'startsAt', width: 20 },
    { header: 'Pilot', key: 'pilotName', width: 22 },
    { header: 'Ort', key: 'location', width: 22 },
    { header: 'Drohne', key: 'drone', width: 16 },
    { header: 'Zweck', key: 'purpose', width: 12 },
    { header: 'Erstellt von', key: 'registeredBy', width: 22 },
    { header: 'Anmerkungen', key: 'notes', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const flight of flights) {
    sheet.addRow({
      startsAt: flight.startsAt.toLocaleString('de-AT'),
      pilotName: `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`,
      location: flight.location,
      drone: flight.drone.name,
      purpose: PURPOSE_LABEL[flight.purpose] ?? flight.purpose,
      registeredBy: `${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`,
      notes: flight.notes ?? '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="drohnenfluege.xlsx"',
    },
  });
}
```

- [ ] **Step 2: Create `src/app/(app)/drohnen/90-tage-export/route.ts`**

```typescript
import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { NINETY_DAY_REQUIRED_FLIGHTS, getNinetyDayCutoff, meetsNinetyDayRule } from '@/lib/drone/ninety-day-rule';
import { listDrohnengruppeMembers } from '@/lib/drone/members';

/** Ersetzt die bisherige /drohnen/90-tage-Unterseite (siehe Drohnengruppe-Brief.md §8.6) - exakt
 * dieselben drei Spalten, die die neue Gruppenstatus-Balkenliste auf der Hauptseite bereits live
 * anzeigt, jetzt als herunterladbare Datei statt als eigene Seite. */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  const allowedGroups = await getAllowedDroneGroups(user);
  if (allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const requestedGroupId = request.nextUrl.searchParams.get('gruppe');
  const group = (requestedGroupId && allowedGroups.find((g) => g.id === requestedGroupId)) || allowedGroups[0];

  const cutoff = getNinetyDayCutoff();
  const [members, counts] = await Promise.all([
    listDrohnengruppeMembers(group.id),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: cutoff }, pilotUser: { droneMembership: { droneGroupId: group.id } } },
      _count: { _all: true },
    }),
  ]);
  const countByPilot = new Map(counts.map((c) => [c.pilotUserId, c._count._all]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('90-Tage-Report');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Flüge (90 Tage)', key: 'count', width: 16 },
    { header: 'Status', key: 'status', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const member of members) {
    const count = countByPilot.get(member.id) ?? 0;
    sheet.addRow({
      name: `${member.lastName} ${member.firstName}`,
      count,
      status: meetsNinetyDayRule(count) ? 'Erfüllt' : 'Offen',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="90-tage-report-${group.name.replace(/[^a-z0-9]+/gi, '-')}.xlsx"`,
    },
  });
}
```

Note: `NINETY_DAY_REQUIRED_FLIGHTS` is imported but only needed if you choose to add a header row
noting the threshold — if you don't use it, remove it from the import list so `tsc`/lint doesn't
flag an unused import.

- [ ] **Step 3: Delete the old 90-tage page**

```bash
rm -rf "src/app/(app)/drohnen/90-tage"
```

- [ ] **Step 4: Check for stale links to the deleted page**

Run: `grep -rn "drohnen/90-tage" src --include=*.tsx --include=*.ts`

Expected: no matches (the only prior reference was the link removed from `/drohnen/page.tsx` in
Task 3, and the deleted page itself). If any match remains, update it to point at
`/drohnen/90-tage-export` (if it's a report link) or remove it.

- [ ] **Step 5: Run `tsc --noEmit` and `npm run build`**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds; `/drohnen/90-tage` no longer appears in the route list, `/drohnen/export` and
`/drohnen/90-tage-export` both appear as dynamic routes.

- [ ] **Step 6: Manual verification against the local dev server**

As an admin, click "Export" and "90-Tage-Report" from `/drohnen` and confirm both download a valid
`.xlsx` file (open it) with the expected columns, scoped to the currently selected group.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/drohnen/export/route.ts" "src/app/(app)/drohnen/90-tage-export/route.ts"
git rm -r "src/app/(app)/drohnen/90-tage"
git commit -m "Drohnengruppe: 90-Tage-Report als Export, alte Unterseite entfernt"
```

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage**: §1 (Berechtigung) → Task 1+3; §2 (Sichtbarkeit) → Task 3; §3 (URL-Zustand) →
  Task 3/`flight-sidebar.tsx`; §4 (Kopfbereich/Sidebar) → Task 3; §5 (Gruppenstatus) → Task 2+3;
  §6 (Flugliste) → Task 2+3; §7 already folded into §6 numbering above — Zustände → Task 3 Step 4
  + inline empty-states in Step 3; §9 Nicht-Ziele → confirmed nothing in any task touches
  `flight.schema.ts`/the create/update/delete actions/`drohnen-schnell`; §10 Abnahme → covered by
  Task 3/4's manual verification steps.
- **Placeholder scan**: no TBD/TODO. The one explicit note-to-self (Task 4 Step 2's unused-import
  reminder) tells the implementer exactly what to check, not a vague "handle appropriately."
- **Type consistency**: `FlightRowData`/`GroupStatusPilot`/`FlightMonthGroup`/
  `getAllowedDroneGroups`/`getDaysUntilExpiry`/`groupFlightsByMonth`/`FLIGHT_COLORS` are named
  identically everywhere they're produced (Tasks 1-2) and consumed (Task 3-4).
- A known, accepted rough edge in Task 3's page code: the `monthGroups` construction attaches a
  `__row` property onto the raw Prisma `flight` objects as a way to carry the already-built
  `FlightRowData` through `groupFlightsByMonth` (which only needs `startsAt` generically) without
  writing a second, duplicate grouping pass over `flightRows` instead of `flights`. This is a
  deliberate, slightly awkward tradeoff to avoid two separate sort-order-must-match-exactly arrays;
  if a task reviewer finds it hard to read, an acceptable alternative is calling
  `groupFlightsByMonth(flightRows.map((r, i) => ({ ...r, startsAt: flights[i].startsAt })))`
  directly on `flightRows` instead - either is fine, prefer whichever the implementer finds
  clearer, but do not leave two independently-maintained arrays that could drift out of sync in
  ordering.
