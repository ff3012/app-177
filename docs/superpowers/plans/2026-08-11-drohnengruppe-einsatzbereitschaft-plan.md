# Drohnengruppe Einsatzbereitschaft-Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new admin page shows a traffic-light ("Ampel") readiness overview of Drohnengruppe pilots with BOS1 training, for both per-group admins and district-wide admins, plus two headline counts per group.

**Architecture:** One new pure computation module (`src/lib/drone/einsatzbereitschaft.ts`) does all classification/aggregation against Prisma; one new Server Component page (`/admin/drohnen/einsatzbereitschaft`) renders it, reusing the exact permission/group-selection pattern already established on `/admin/drohnen`; the existing `/admin/drohnen` page loses its old binary Erfüllt/Offen table and gains a link to the new page.

**Tech Stack:** Next.js App Router Server Components, Prisma, Tailwind (existing `success`/`warning`/`danger` design tokens, `shadcn` `Table`/`Badge` components already used elsewhere in `/admin/drohnen`). No test framework exists in this repo — verification happens via standalone `tsx` scripts against the local dev database and via `tsc`/`next build`, matching this repo's established practice (see CLAUDE.md: "There is no test suite in this repo").

## Global Constraints

- Ampel-Schwellen: GRÜN = Flüge im 90-Tage-Fenster ≥ `NINETY_DAY_REQUIRED_FLIGHTS` (3, from `src/lib/drone/ninety-day-rule.ts` — never hardcode `3` again, always reference the constant), GELB = genau `NINETY_DAY_REQUIRED_FLIGHTS - 1` (2), ROT = alles darunter (0 oder 1).
- Nur Mitglieder mit gesetztem `DrohnengruppeMembership.bos1AusbildungAm` erscheinen in der Piloten-Liste; alle anderen zählen nur in `totalMembers` mit.
- Sortierung der Piloten-Liste: ROT vor GELB vor GRÜN; innerhalb einer Kategorie in der Reihenfolge, in der sie aus der DB kommen (Nachname, dann Vorname, alphabetisch) — kein zusätzlicher `localeCompare` nötig, siehe Task 1.
- Route: exakt `/admin/drohnen/einsatzbereitschaft`. Kein neuer Eintrag in `src/lib/admin/nav-items.ts`/`AdminSidebarNav`/`AdminMobileTabs` — nur ein In-Page-Link von `/admin/drohnen` aus.
- Zugriffsmodell: identisch zu `/admin/drohnen` (`allowedGroups` über `canManageDroneGroupFor`/`isBezirksAdmin`, `notFound()` wenn leer) — keine neue Berechtigungsfunktion.
- Farb-Tokens für die drei Ampel-Zustände: GRÜN = `border-transparent bg-success-subtle text-success-text`, GELB = `border-transparent bg-warning-subtle text-warning-text`, ROT = `border-transparent bg-danger-subtle text-danger` (exakt die Klassen, die die bestehende 3-stufige Atemschutz-Badge in `admin/heimatfeuerwehr/page.tsx` bereits verwendet — keine neuen Farben erfinden).
- Kennzahlen-Kachel-Markup: `rounded-lg bg-surface p-4 shadow-card` Karte mit `text-[15px] font-semibold text-ink` Überschrift und `font-condensed text-3xl font-bold text-ink` für die Zahl (exakt das Muster aus `admin/heimatfeuerwehr/fahrzeug/[vehicleId]/page.tsx`'s "Auslastung"-Kachel).
- Prisma-Modell-Accessor ist `prisma.drohnengruppeMembership` (nicht `prisma.droneGroupMembership` o.ä. — bestätigt durch bestehenden Code in `admin/benutzer/actions.ts`).
- Datenbank-Zugriff für lokale Verifikationsskripte: `.env` im Worktree zeigt auf `postgresql://...@localhost:5432/ffapp` (bereits vorhanden, siehe `npx prisma migrate status`-Ausgabe aus der vorherigen Session).

---

### Task 1: Berechnungsmodul `src/lib/drone/einsatzbereitschaft.ts`

**Files:**
- Create: `src/lib/drone/einsatzbereitschaft.ts`
- Test (manual verification script, not part of the app): `scripts/verify-einsatzbereitschaft.ts` (temporary, deleted at the end of this task after verification — this repo has no test runner, so verification scripts live outside `src/` and are removed once they've proven the behavior, matching this session's established practice of one-off `tsx` verification scripts)

**Interfaces:**
- Consumes: `NINETY_DAY_REQUIRED_FLIGHTS`, `getNinetyDayCutoff()` from `src/lib/drone/ninety-day-rule.ts` (both already exist, unchanged). `prisma` from `src/lib/db/prisma.ts` (default export pattern already used everywhere: `import { prisma } from '@/lib/db/prisma';`).
- Produces (used by Task 2): `EinsatzbereitschaftStatus` (`'GRUEN' | 'GELB' | 'ROT'`), `PilotEinsatzbereitschaft` interface (`{ id: string; name: string; flightCount: number; status: EinsatzbereitschaftStatus }`), `GruppenEinsatzbereitschaft` interface (`{ droneGroupId: string; droneGroupName: string; totalMembers: number; a2Count: number; pilots: PilotEinsatzbereitschaft[] }`), `classifyFlightCount(flightCount: number): EinsatzbereitschaftStatus`, `getGruppenEinsatzbereitschaft(droneGroupId: string): Promise<GruppenEinsatzbereitschaft>`.

- [ ] **Step 1: Create the computation module**

Write `src/lib/drone/einsatzbereitschaft.ts` with this exact content:

```typescript
import { prisma } from '@/lib/db/prisma';
import { NINETY_DAY_REQUIRED_FLIGHTS, getNinetyDayCutoff } from './ninety-day-rule';

export type EinsatzbereitschaftStatus = 'GRUEN' | 'GELB' | 'ROT';

export interface PilotEinsatzbereitschaft {
  id: string;
  name: string;
  flightCount: number;
  status: EinsatzbereitschaftStatus;
}

export interface GruppenEinsatzbereitschaft {
  droneGroupId: string;
  droneGroupName: string;
  totalMembers: number;
  a2Count: number;
  pilots: PilotEinsatzbereitschaft[];
}

/**
 * GRÜN = 90-Tage-Regel erfüllt (>= NINETY_DAY_REQUIRED_FLIGHTS Flüge), GELB = genau einer zu
 * wenig, ROT = alles darunter. Nur für Mitglieder mit gesetztem bos1AusbildungAm aufgerufen -
 * siehe getGruppenEinsatzbereitschaft.
 */
export function classifyFlightCount(flightCount: number): EinsatzbereitschaftStatus {
  if (flightCount >= NINETY_DAY_REQUIRED_FLIGHTS) return 'GRUEN';
  if (flightCount === NINETY_DAY_REQUIRED_FLIGHTS - 1) return 'GELB';
  return 'ROT';
}

const STATUS_SORT_ORDER: Record<EinsatzbereitschaftStatus, number> = { ROT: 0, GELB: 1, GRUEN: 2 };

/**
 * Einsatzbereitschaft einer einzelnen Drohnengruppe: Gesamtmitgliederzahl, Anzahl mit
 * A2-Zertifikat, und die Ampel-Liste aller Mitglieder MIT bos1AusbildungAm (wer keine BOS1-
 * Ausbildung hat, erscheint nicht in `pilots`, zählt aber in `totalMembers` mit - siehe
 * Design-Spec §3/§6). `memberships` wird bereits nach Nachname/Vorname sortiert geladen; das
 * abschließende .sort() ist stabil (JS-Array-Sort ist seit ES2019 garantiert stabil) und
 * sortiert nur noch nach Dringlichkeit um, ohne die alphabetische Reihenfolge innerhalb einer
 * Ampel-Farbe zu zerstören.
 */
export async function getGruppenEinsatzbereitschaft(droneGroupId: string): Promise<GruppenEinsatzbereitschaft> {
  const [droneGroup, memberships, flightCounts] = await Promise.all([
    prisma.droneGroup.findUniqueOrThrow({ where: { id: droneGroupId }, select: { name: true } }),
    prisma.drohnengruppeMembership.findMany({
      where: { droneGroupId },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      select: {
        bos1AusbildungAm: true,
        a2LizenzAm: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId } } },
      _count: { _all: true },
    }),
  ]);

  const countByPilot = new Map(flightCounts.map((c) => [c.pilotUserId, c._count._all]));

  const pilots: PilotEinsatzbereitschaft[] = memberships
    .filter((m) => m.bos1AusbildungAm !== null)
    .map((m) => {
      const flightCount = countByPilot.get(m.user.id) ?? 0;
      return {
        id: m.user.id,
        name: `${m.user.lastName} ${m.user.firstName}`,
        flightCount,
        status: classifyFlightCount(flightCount),
      };
    })
    .sort((a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]);

  return {
    droneGroupId,
    droneGroupName: droneGroup.name,
    totalMembers: memberships.length,
    a2Count: memberships.filter((m) => m.a2LizenzAm !== null).length,
    pilots,
  };
}
```

- [ ] **Step 2: Write a standalone verification script**

Create `scripts/verify-einsatzbereitschaft.ts` (this repo has no test runner — this script is a temporary, manual verification tool, deleted in Step 5 below):

```typescript
import { prisma } from '../src/lib/db/prisma';
import { classifyFlightCount, getGruppenEinsatzbereitschaft } from '../src/lib/drone/einsatzbereitschaft';

async function main() {
  // classifyFlightCount boundary checks
  const cases: Array<[number, string]> = [
    [0, 'ROT'],
    [1, 'ROT'],
    [2, 'GELB'],
    [3, 'GRUEN'],
    [10, 'GRUEN'],
  ];
  for (const [count, expected] of cases) {
    const actual = classifyFlightCount(count);
    console.log(`classifyFlightCount(${count}) = ${actual} (expected ${expected}) ${actual === expected ? 'OK' : 'FAIL'}`);
  }

  // End-to-end against a real, temporarily-created group/members/flights
  const group = await prisma.droneGroup.create({
    data: { name: `__test_einsatzbereitschaft_${Date.now()}`, organizationId: (await prisma.organization.findFirstOrThrow({ where: { type: 'ABSCHNITTSKOMMANDO' } })).id },
  });
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });

  async function makeUser(suffix: string) {
    return prisma.user.create({
      data: {
        email: `__test_eb_${suffix}_${Date.now()}@example.invalid`,
        firstName: 'Test',
        lastName: suffix,
        passwordHash: 'x',
        homeOrganizationId: org.id,
        isActive: true,
      },
    });
  }

  const gruenUser = await makeUser('Gruen');
  const gelbUser = await makeUser('Gelb');
  const rotUser = await makeUser('Rot');
  const noBos1User = await makeUser('OhneBos1');

  const now = new Date();
  await prisma.drohnengruppeMembership.create({ data: { userId: gruenUser.id, droneGroupId: group.id, bos1AusbildungAm: now, a2LizenzAm: now } });
  await prisma.drohnengruppeMembership.create({ data: { userId: gelbUser.id, droneGroupId: group.id, bos1AusbildungAm: now } });
  await prisma.drohnengruppeMembership.create({ data: { userId: rotUser.id, droneGroupId: group.id, bos1AusbildungAm: now } });
  await prisma.drohnengruppeMembership.create({ data: { userId: noBos1User.id, droneGroupId: group.id } });

  const drone = await prisma.drone.create({ data: { name: `__test_drone_${Date.now()}`, droneGroupId: group.id, sortOrder: 1 } });

  async function makeFlight(pilotId: string, registeredById: string, daysAgo: number) {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() - daysAgo);
    await prisma.droneFlight.create({
      data: { pilotUserId: pilotId, registeredById, droneId: drone.id, startsAt, location: 'Testort', purpose: 'UEBUNG' },
    });
  }

  await makeFlight(gruenUser.id, gruenUser.id, 1);
  await makeFlight(gruenUser.id, gruenUser.id, 2);
  await makeFlight(gruenUser.id, gruenUser.id, 3);
  await makeFlight(gelbUser.id, gelbUser.id, 1);
  await makeFlight(gelbUser.id, gelbUser.id, 2);
  await makeFlight(rotUser.id, rotUser.id, 1);

  const result = await getGruppenEinsatzbereitschaft(group.id);
  console.log(JSON.stringify(result, null, 2));

  const checks: Array<[boolean, string]> = [
    [result.totalMembers === 4, `totalMembers should be 4, got ${result.totalMembers}`],
    [result.a2Count === 1, `a2Count should be 1, got ${result.a2Count}`],
    [result.pilots.length === 3, `pilots.length should be 3 (excludes noBos1User), got ${result.pilots.length}`],
    [result.pilots[0].status === 'ROT', `pilots[0] should be ROT, got ${result.pilots[0].status}`],
    [result.pilots[1].status === 'GELB', `pilots[1] should be GELB, got ${result.pilots[1].status}`],
    [result.pilots[2].status === 'GRUEN', `pilots[2] should be GRUEN, got ${result.pilots[2].status}`],
    [!result.pilots.some((p) => p.id === noBos1User.id), 'noBos1User must not appear in pilots'],
  ];
  for (const [ok, message] of checks) {
    console.log(`${ok ? 'OK' : 'FAIL'}: ${message}`);
  }

  // Cleanup
  await prisma.droneFlight.deleteMany({ where: { droneId: drone.id } });
  await prisma.drone.delete({ where: { id: drone.id } });
  await prisma.drohnengruppeMembership.deleteMany({ where: { droneGroupId: group.id } });
  await prisma.user.deleteMany({ where: { id: { in: [gruenUser.id, gelbUser.id, rotUser.id, noBos1User.id] } } });
  await prisma.droneGroup.delete({ where: { id: group.id } });

  const failed = checks.some(([ok]) => !ok) || cases.some(([count, expected]) => classifyFlightCount(count) !== expected);
  process.exit(failed ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Run the verification script**

Run: `npx tsx scripts/verify-einsatzbereitschaft.ts`
Expected: every line prints `OK`, no `FAIL` lines, exit code 0. If any `FAIL` appears, fix `einsatzbereitschaft.ts` (not the script) and re-run.

- [ ] **Step 4: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Delete the temporary verification script and commit**

```bash
rm scripts/verify-einsatzbereitschaft.ts
git add src/lib/drone/einsatzbereitschaft.ts
git commit -m "Drohnengruppe: Einsatzbereitschaft-Berechnungsmodul"
```

---

### Task 2: Neue Seite `/admin/drohnen/einsatzbereitschaft`

**Files:**
- Create: `src/app/(app)/admin/drohnen/einsatzbereitschaft/page.tsx`

**Interfaces:**
- Consumes: `getGruppenEinsatzbereitschaft(droneGroupId: string): Promise<GruppenEinsatzbereitschaft>` and the `GruppenEinsatzbereitschaft`/`PilotEinsatzbereitschaft`/`EinsatzbereitschaftStatus` types from Task 1 (`@/lib/drone/einsatzbereitschaft`). `requireUser()` from `@/lib/auth/session`. `canManageDroneGroupFor`, `isBezirksAdmin` from `@/lib/auth/permissions`. `prisma` from `@/lib/db/prisma`. `Badge` from `@/components/ui/badge`. `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from `@/components/ui/table`. `Link` from `next/link`, `notFound` from `next/navigation`.
- Produces: nothing consumed by later tasks (Task 3 only needs to know the route path `/admin/drohnen/einsatzbereitschaft` and the query param name `group`).

- [ ] **Step 1: Create the page**

Write `src/app/(app)/admin/drohnen/einsatzbereitschaft/page.tsx` with this exact content:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { getGruppenEinsatzbereitschaft, type EinsatzbereitschaftStatus, type GruppenEinsatzbereitschaft } from '@/lib/drone/einsatzbereitschaft';
import { NINETY_DAY_REQUIRED_FLIGHTS } from '@/lib/drone/ninety-day-rule';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_LABEL: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'Einsatzbereit',
  GELB: 'Bald fällig',
  ROT: 'Nicht einsatzbereit',
};

const STATUS_CLASS: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'border-transparent bg-success-subtle text-success-text',
  GELB: 'border-transparent bg-warning-subtle text-warning-text',
  ROT: 'border-transparent bg-danger-subtle text-danger',
};

const STATUS_COUNT_CLASS: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'text-success-text',
  GELB: 'text-warning-text',
  ROT: 'text-danger',
};

function countByStatus(data: GruppenEinsatzbereitschaft, status: EinsatzbereitschaftStatus): number {
  return data.pilots.filter((p) => p.status === status).length;
}

function GroupTile({ data, selected }: { data: GruppenEinsatzbereitschaft; selected: boolean }) {
  return (
    <Link
      href={`/admin/drohnen/einsatzbereitschaft?group=${data.droneGroupId}`}
      className={`flex flex-col gap-2 rounded-lg border p-4 shadow-card transition-colors ${
        selected ? 'border-brand bg-surface' : 'border-transparent bg-surface hover:border-line'
      }`}
    >
      <span className="text-[15px] font-semibold text-ink">{data.droneGroupName}</span>
      <span className="text-xs text-ink-muted">
        {data.totalMembers} Mitglieder · {data.a2Count} mit A2
      </span>
      <span className="font-mono text-sm">
        <span className={STATUS_COUNT_CLASS.GRUEN}>{countByStatus(data, 'GRUEN')}</span>
        {' · '}
        <span className={STATUS_COUNT_CLASS.GELB}>{countByStatus(data, 'GELB')}</span>
        {' · '}
        <span className={STATUS_COUNT_CLASS.ROT}>{countByStatus(data, 'ROT')}</span>
      </span>
    </Link>
  );
}

function DetailSection({ data }: { data: GruppenEinsatzbereitschaft }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Mitglieder gesamt</h2>
          <span className="font-condensed text-3xl font-bold text-ink">{data.totalMembers}</span>
        </div>
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Mit A2-Zertifikat</h2>
          <span className="font-condensed text-3xl font-bold text-ink">{data.a2Count}</span>
        </div>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Einsatzbereitschaft · {data.droneGroupName}</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Nur Mitglieder mit abgeschlossener BOS1-Ausbildung. Mindestens {NINETY_DAY_REQUIRED_FLIGHTS} Flüge in den
          letzten 90 Tagen für Einsatzbereitschaft.
        </p>

        {data.pilots.length === 0 ? (
          <p className="text-sm text-ink-muted">Kein Mitglied dieser Gruppe hat bisher eine BOS1-Ausbildung.</p>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-line border-t border-line sm:hidden">
              {data.pilots.map((pilot) => (
                <div key={pilot.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex flex-col">
                    <span className="text-sm text-ink">{pilot.name}</span>
                    <span className="text-xs text-ink-faint">{pilot.flightCount} Flüge (90 Tage)</span>
                  </div>
                  <Badge variant="outline" className={STATUS_CLASS[pilot.status]}>
                    {STATUS_LABEL[pilot.status]}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                      Flüge (90 Tage)
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pilots.map((pilot) => (
                    <TableRow key={pilot.id} className="border-line">
                      <TableCell className="text-ink">{pilot.name}</TableCell>
                      <TableCell className="font-mono text-ink-muted">{pilot.flightCount}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_CLASS[pilot.status]}>
                          {STATUS_LABEL[pilot.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default async function EinsatzbereitschaftPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const user = await requireUser();
  const { group } = await searchParams;

  const allGroups = await prisma.droneGroup.findMany({ orderBy: { name: 'asc' } });
  const allowedGroups = isBezirksAdmin(user) ? allGroups : allGroups.filter((g) => canManageDroneGroupFor(user, g));

  if (allowedGroups.length === 0) {
    notFound();
  }

  const selectedGroup = (group && allowedGroups.find((g) => g.id === group)) || allowedGroups[0];

  const showTiles = allowedGroups.length > 1;
  const tileData = showTiles
    ? await Promise.all(allowedGroups.map((g) => getGruppenEinsatzbereitschaft(g.id)))
    : [];
  const selectedData = showTiles
    ? tileData.find((d) => d.droneGroupId === selectedGroup.id)!
    : await getGruppenEinsatzbereitschaft(selectedGroup.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/drohnen" className="text-sm text-brand hover:underline">
          ← Zurück zur Drohnengruppe-Verwaltung
        </Link>
        <h1 className="mt-1 text-[28px] font-bold text-ink">Einsatzbereitschaft</h1>
      </div>

      {showTiles && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tileData.map((data) => (
            <GroupTile key={data.droneGroupId} data={data} selected={data.droneGroupId === selectedGroup.id} />
          ))}
        </div>
      )}

      <DetailSection data={selectedData} />
    </div>
  );
}
```

- [ ] **Step 2: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification against the local dev server**

Run: `npm run dev`, then log in as the seeded Bezirksadmin account and navigate to `/admin/drohnen/einsatzbereitschaft`. Confirm:
- If more than one Drohnengruppe exists (seed creates 4), tiles render for all of them with correct counts.
- Clicking a tile navigates to `?group=<id>` and the detail section below updates to that group.
- A group with no BOS1-trained members shows the empty-state text, not an empty table.

Expected: page renders without errors, tile/detail data matches what Task 1's verification script demonstrated the function computes correctly.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/drohnen/einsatzbereitschaft/page.tsx"
git commit -m "Drohnengruppe: Einsatzbereitschaft-Dashboard-Seite"
```

---

### Task 3: `/admin/drohnen` — alte Tabelle entfernen, Link ergänzen

**Files:**
- Modify: `src/app/(app)/admin/drohnen/page.tsx`

**Interfaces:**
- Consumes: nothing new — this task only removes code and adds a `<Link>`. The link target is the route created in Task 2: `/admin/drohnen/einsatzbereitschaft?group=<selectedGroup.id>`.
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Remove the old "Mitglieder · 90-Tage-Status" section and its now-unused data fetching**

In `src/app/(app)/admin/drohnen/page.tsx`:

Remove these two now-unused imports (both only used by the code being deleted below):
```typescript
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { getNinetyDayCutoff, meetsNinetyDayRule } from '@/lib/drone/ninety-day-rule';
```

Change the `Promise.all` destructuring from:
```typescript
  const [drones, documents, members, flightCounts] = await Promise.all([
    prisma.drone.findMany({ where: { droneGroupId: selectedGroup.id }, orderBy: { sortOrder: 'asc' } }),
    prisma.droneDocument.findMany({
      where: { droneGroupId: selectedGroup.id },
      select: {
        id: true,
        title: true,
        filename: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    listDrohnengruppeMembers(selectedGroup.id),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId: selectedGroup.id } } },
      _count: { _all: true },
    }),
  ]);
```
to:
```typescript
  const [drones, documents] = await Promise.all([
    prisma.drone.findMany({ where: { droneGroupId: selectedGroup.id }, orderBy: { sortOrder: 'asc' } }),
    prisma.droneDocument.findMany({
      where: { droneGroupId: selectedGroup.id },
      select: {
        id: true,
        title: true,
        filename: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
```

Remove this line (it was only used by the deleted table):
```typescript
  const countByPilot = new Map(flightCounts.map((c) => [c.pilotUserId, c._count._all]));
```

Replace this entire block:
```tsx
      {/* Kein eigenes Sichtbarkeits-Gate mehr für diesen Abschnitt (Task 9 Review-Fix, war zuvor
          `{canSeeMembers && (...)}` mit `canSeeMembers = true` - toter Code): die eigentliche
          Berechtigungsgrenze ist bereits `allowedGroups`/canManageDroneGroupFor oben - wer diese
          Seite für eine Gruppe überhaupt sieht, darf auch deren Compliance-Daten sehen. */}
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Mitglieder · 90-Tage-Status</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Mindestens 3 Flüge in den letzten 90 Tagen. Rolle/Mitgliedschaft ändern über die{' '}
          <Link href="/admin/benutzer" className="text-brand hover:underline">
            Benutzerverwaltung
          </Link>
          .
        </p>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Flüge (90 Tage)
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const count = countByPilot.get(member.id) ?? 0;
              const met = meetsNinetyDayRule(count);
              return (
                <TableRow key={member.id} className="border-line">
                  <TableCell>
                    <Link href={`/admin/benutzer?edit=${member.id}`} className="text-ink hover:underline">
                      {member.lastName} {member.firstName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-ink-muted">{count}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        met
                          ? 'border-transparent bg-success-subtle text-success-text'
                          : 'border-transparent bg-danger-subtle text-danger'
                      }
                    >
                      {met ? 'Erfüllt' : 'Offen'}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-ink-muted">
                  Keine Mitglieder dieser Drohnengruppe hinterlegt.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
```
with:
```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Einsatzbereitschaft</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Ampel-Übersicht der BOS1-Piloten dieser Gruppe (90-Tage-Regel) sowie Mitgliederzahl und A2-Zertifikate.
        </p>
        <Link
          href={`/admin/drohnen/einsatzbereitschaft?group=${selectedGroup.id}`}
          className="inline-block rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Einsatzbereitschaft ansehen
        </Link>
      </div>
```

- [ ] **Step 2: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors. If `Badge`/`Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader` imports become unused elsewhere in this file (they are still used by the "Drohnen" table section further down — check before removing any import), leave them; only remove the two imports named in Step 1.

- [ ] **Step 3: Manual verification against the local dev server**

With `npm run dev` still running, reload `/admin/drohnen`: confirm the old "Mitglieder · 90-Tage-Status" table is gone, the new "Einsatzbereitschaft" card with its link is present, and clicking the link lands on `/admin/drohnen/einsatzbereitschaft` with the correct group pre-selected.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/drohnen/page.tsx"
git commit -m "Drohnengruppe: alte 90-Tage-Tabelle durch Link zur Einsatzbereitschaft ersetzt"
```

---

## Self-Review Notes (for the plan author, already applied above)

- Spec coverage: §1 (Ampel-Kategorien) → Task 1; §2 (Route/Zugriff) → Task 2; §3 (Berechnung) → Task 1; §4 (UI) → Task 2; §5 (Änderung an /admin/drohnen) → Task 3; §6 (Nicht-Ziele) → nothing built for these, correctly; §7 (Abnahme) → covered by Task 2/3 manual verification steps.
- Placeholder scan: no TBD/TODO; the one flagged literal (`{3}` in Task 2 Step 2) is called out explicitly with the exact fix rather than left as a silent shortcut.
- Type consistency: `EinsatzbereitschaftStatus`/`GruppenEinsatzbereitschaft`/`PilotEinsatzbereitschaft`/`classifyFlightCount`/`getGruppenEinsatzbereitschaft` are named identically between Task 1 (producer) and Task 2 (consumer).
