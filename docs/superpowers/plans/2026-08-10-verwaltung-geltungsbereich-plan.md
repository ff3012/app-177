# Verwaltung: Geltungsbereich-Wähler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a reusable, permission-checked Geltungsbereich-Wähler (scope selector: Bezirk/
Abschnitt/Feuerwehr) above the `/admin/*` navigation, persisted via URL query params + localStorage.

**Architecture:** A new pure-logic module (`src/lib/admin/scope.ts`) computes which
Bezirk/Abschnitt/Feuerwehr entries a given `SessionUser` may administer, reusing already-established
`SessionUser` fields (`isBezirksAdmin`/`abschnittAdminOrgIds`/`feuerwehrAdminOrgIds`) - no new
permission logic. A new client component (`GeltungsbereichSelector`) renders the popover/tree UI and
owns reading/writing the current selection via `?ebene=&org=` query params (read client-side via
`useSearchParams()`, since `admin/layout.tsx` cannot receive `searchParams` itself - see Global
Constraints) plus a `localStorage` default. It's wired into the existing `AdminSidebar` (desktop) and
into each of the 5 existing `/admin/*` pages (mobile, matching their existing `AdminMobileTabs`
placement convention).

**Tech Stack:** Next.js App Router (Server + Client Components), Prisma, existing shadcn
`Popover`/`Command` primitives (same as `AdminOrgMultiSelect`), no new dependencies.

## Global Constraints

- Next.js layouts (`admin/layout.tsx`) never receive `searchParams` - only `page.tsx` files do. The
  selector must read the current scope client-side (`useSearchParams()`), not via a prop threaded
  from a layout.
- No nested URL routing (`/admin/bezirk/17/…`) - flat URLs with `?ebene=bezirk|abschnitt|feuerwehr`
  and `?org=<id>` query params only (explicit user decision).
- This phase does **not** filter any existing list by the selected scope - it only ships the
  selector and its persistence mechanism. Do not wire it into any Prisma query.
- `getReachableScopes`/`resolveAdminScope` must build exclusively on the already-existing
  `SessionUser` fields `isBezirksAdmin`, `abschnittAdminOrgIds`, `feuerwehrAdminOrgIds` - no new
  permission predicate, no schema change.
- Reuse `getAbschnittOrganizationId` (`src/lib/organizations/abschnitt.ts`) instead of a bare
  `parentId!` non-null assertion when resolving a Feuerwehr's Abschnitt - this codebase has a
  documented incident where a silent `parentId!` produced a cryptic Prisma error instead of a clear
  one; the helper throws a clear error instead.
- There is no test suite in this repo (see CLAUDE.md). Verify each task via `npx tsc --noEmit`, a
  targeted standalone script run with `npx tsx` against the real dev database (delete the script
  afterward), and (for the final task) `npm run build`.

---

### Task 1: `src/lib/admin/scope.ts` - reachable scopes + resolver

**Files:**
- Create: `src/lib/admin/scope.ts`

**Interfaces:**
- Produces: `AdminScope` (discriminated union), `getReachableScopes(user: SessionUser):
  Promise<AdminScope[]>`, `ScopeResolution`, `resolveAdminScope(reachable: AdminScope[], rawEbene:
  string | undefined, rawOrg: string | undefined): ScopeResolution`.

- [ ] **Step 1: Write the file**

```typescript
import { prisma } from '@/lib/db/prisma';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';
import type { SessionUser } from '@/types/next-auth';

export type AdminScope =
  | { level: 'BEZIRK' }
  | { level: 'ABSCHNITT'; organizationId: string; name: string }
  | { level: 'FEUERWEHR'; organizationId: string; name: string; abschnittOrganizationId: string };

/**
 * Alle Geltungsbereiche, die dieser Benutzer tatsächlich verwalten darf - Grundlage für den
 * Geltungsbereich-Wähler (Verwaltung-Filter-Brief.md §2, Design-Spec §4). Baut ausschließlich auf
 * bereits etablierten SessionUser-Feldern auf (isBezirksAdmin/abschnittAdminOrgIds/
 * feuerwehrAdminOrgIds), keine neue Rechteentscheidung - nur eine neue Sicht auf bestehende. Kann
 * für einen reinen Drohnengruppen-/Bezirks-Drohnenadmin ohne jedes Organisations-Admin-Recht ein
 * leeres Array liefern - das ist korrekt, dieser Nutzer hat schlicht keinen Bezirk/Abschnitt/
 * Feuerwehr-Geltungsbereich (nur /admin/drohnen, das dieses Konzept nicht verwendet).
 */
export async function getReachableScopes(user: SessionUser): Promise<AdminScope[]> {
  if (isBezirksAdmin(user)) {
    const [abschnitte, feuerwehren] = await Promise.all([
      prisma.organization.findMany({
        where: { type: 'ABSCHNITTSKOMMANDO' },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: 'asc' },
      }),
      prisma.organization.findMany({
        where: { type: 'FEUERWEHR' },
        select: { id: true, name: true, shortName: true, parentId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return [
      { level: 'BEZIRK' },
      ...abschnitte.map((org) => ({
        level: 'ABSCHNITT' as const,
        organizationId: org.id,
        name: org.shortName ?? org.name,
      })),
      ...feuerwehren.map((org) => ({
        level: 'FEUERWEHR' as const,
        organizationId: org.id,
        name: org.shortName ?? org.name,
        abschnittOrganizationId: getAbschnittOrganizationId({ type: 'FEUERWEHR', id: org.id, parentId: org.parentId }),
      })),
    ];
  }

  const scopes: AdminScope[] = [];
  const coveredFeuerwehrIds = new Set<string>();

  if (user.abschnittAdminOrgIds.length > 0) {
    const [abschnitte, feuerwehren] = await Promise.all([
      prisma.organization.findMany({
        where: { id: { in: user.abschnittAdminOrgIds } },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: 'asc' },
      }),
      prisma.organization.findMany({
        where: { parentId: { in: user.abschnittAdminOrgIds } },
        select: { id: true, name: true, shortName: true, parentId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    for (const org of abschnitte) {
      scopes.push({ level: 'ABSCHNITT', organizationId: org.id, name: org.shortName ?? org.name });
    }
    for (const org of feuerwehren) {
      scopes.push({
        level: 'FEUERWEHR',
        organizationId: org.id,
        name: org.shortName ?? org.name,
        abschnittOrganizationId: getAbschnittOrganizationId({ type: 'FEUERWEHR', id: org.id, parentId: org.parentId }),
      });
      coveredFeuerwehrIds.add(org.id);
    }
  }

  // feuerwehrAdminOrgIds enthält bereits jede Feuerwehr aus der Abschnitts-Vererbung oben (siehe
  // build-session-user.ts) PLUS jede direkt verwaltete Feuerwehr - hier bleiben nur die direkten
  // übrig, die oben noch nicht als Teil eines verwalteten Abschnitts gezählt wurden.
  const directFeuerwehrIds = user.feuerwehrAdminOrgIds.filter(
    (id) => !coveredFeuerwehrIds.has(id) && !user.abschnittAdminOrgIds.includes(id),
  );
  if (directFeuerwehrIds.length > 0) {
    const feuerwehren = await prisma.organization.findMany({
      where: { id: { in: directFeuerwehrIds } },
      select: { id: true, name: true, shortName: true, parentId: true },
      orderBy: { name: 'asc' },
    });
    for (const org of feuerwehren) {
      scopes.push({
        level: 'FEUERWEHR',
        organizationId: org.id,
        name: org.shortName ?? org.name,
        abschnittOrganizationId: getAbschnittOrganizationId({ type: 'FEUERWEHR', id: org.id, parentId: org.parentId }),
      });
    }
  }

  return scopes;
}

const LEVEL_ORDER: Record<AdminScope['level'], number> = { BEZIRK: 0, ABSCHNITT: 1, FEUERWEHR: 2 };

function sortScopes(scopes: AdminScope[]): AdminScope[] {
  return [...scopes].sort((a, b) => {
    if (LEVEL_ORDER[a.level] !== LEVEL_ORDER[b.level]) return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (a.level === 'BEZIRK') return 0;
    return (a as { name: string }).name.localeCompare((b as { name: string }).name);
  });
}

export interface ScopeResolution {
  scope: AdminScope;
  /** true, wenn der übergebene Parameter zwar syntaktisch gültig, aber für DIESEN Benutzer nicht
   * erreichbar war (fremder Abschnitt/fremde Feuerwehr per URL) - der Aufrufer entscheidet, ob er
   * daraufhin notFound() wirft oder den Fallback stillschweigend übernimmt. In dieser Phase hat das
   * noch keinen Aufrufer außer dem Wähler selbst; ab Phase 3/4, wenn echte Listen danach filtern,
   * wird dieses Feld zur Sicherheitsgrenze. */
  requestedButUnreachable: boolean;
}

/**
 * Reine Funktion (keine DB, keine Session) - löst einen rohen `?ebene=&org=`-Parameter gegen die
 * bereits berechnete reachable-Liste auf. Fällt niemals auf einen Wert außerhalb reachable zurück.
 * Voraussetzung: reachable ist nicht leer - der einzige Aufrufer in dieser Phase (der Wähler selbst)
 * rendert ohnehin nur, wenn reachable.length > 1 ist.
 */
export function resolveAdminScope(
  reachable: AdminScope[],
  rawEbene: string | undefined,
  rawOrg: string | undefined,
): ScopeResolution {
  const fallback = sortScopes(reachable)[0];

  if (!rawEbene) {
    return { scope: fallback, requestedButUnreachable: false };
  }

  const match = reachable.find((scope) => {
    if (rawEbene === 'bezirk') return scope.level === 'BEZIRK';
    if (rawEbene === 'abschnitt') return scope.level === 'ABSCHNITT' && scope.organizationId === rawOrg;
    if (rawEbene === 'feuerwehr') return scope.level === 'FEUERWEHR' && scope.organizationId === rawOrg;
    return false;
  });

  if (match) {
    return { scope: match, requestedButUnreachable: false };
  }

  return { scope: fallback, requestedButUnreachable: true };
}
```

- [ ] **Step 2: Verify with `tsc`**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Verify with a standalone script against the real dev database**

Create `scripts-tmp-verify-scope.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { getReachableScopes, resolveAdminScope, type AdminScope } from './src/lib/admin/scope';
import type { SessionUser } from './src/types/next-auth';

const prisma = new PrismaClient();

function fakeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'x', email: 'x@x.com', name: 'X', homeOrganizationId: 'x', homeOrganizationType: 'FEUERWEHR',
    homeAbschnittOrganizationId: 'x', feuerwehrAdminOrgIds: [], abschnittAdminOrgIds: [],
    isBezirksAdmin: false, isBezirksDrohnenAdmin: false, isAbschnittskommandoMitglied: false,
    isDrohnengruppeMember: false, droneGroupId: null, droneGroupRole: null,
    ...overrides,
  };
}

async function main() {
  // Bezirksadmin: sees BEZIRK + every Abschnitt + every Feuerwehr.
  const bezirksadmin = fakeUser({ isBezirksAdmin: true });
  const bezirkScopes = await getReachableScopes(bezirksadmin);
  const abschnitteCount = await prisma.organization.count({ where: { type: 'ABSCHNITTSKOMMANDO' } });
  const feuerwehrenCount = await prisma.organization.count({ where: { type: 'FEUERWEHR' } });
  console.log('Bezirksadmin sees BEZIRK:', bezirkScopes.some((s) => s.level === 'BEZIRK'));
  console.log(
    'Bezirksadmin sees all Abschnitte:',
    bezirkScopes.filter((s) => s.level === 'ABSCHNITT').length === abschnitteCount,
  );
  console.log(
    'Bezirksadmin sees all Feuerwehren:',
    bezirkScopes.filter((s) => s.level === 'FEUERWEHR').length === feuerwehrenCount,
  );

  // Plain Feuerwehr-Admin (one org, direct membership only): sees exactly that one FEUERWEHR scope.
  const someFeuerwehr = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const feuerwehrAdmin = fakeUser({ feuerwehrAdminOrgIds: [someFeuerwehr.id] });
  const feuerwehrScopes = await getReachableScopes(feuerwehrAdmin);
  console.log(
    'Plain Feuerwehr-Admin sees exactly 1 scope, that Feuerwehr:',
    feuerwehrScopes.length === 1 && feuerwehrScopes[0].level === 'FEUERWEHR' &&
      (feuerwehrScopes[0] as { organizationId: string }).organizationId === someFeuerwehr.id,
  );

  // Feuerwehr-Admin with TWO direct memberships (no Abschnitt-level right at all): sees exactly
  // those two Feuerwehren as separate scopes - this is the shape that makes the selector actually
  // appear for a plain Feuerwehr-Admin (reachable.length > 1).
  const twoFeuerwehren = await prisma.organization.findMany({ where: { type: 'FEUERWEHR' }, take: 2 });
  const multiFeuerwehrAdmin = fakeUser({ feuerwehrAdminOrgIds: twoFeuerwehren.map((f) => f.id) });
  const multiFeuerwehrScopes = await getReachableScopes(multiFeuerwehrAdmin);
  console.log(
    'Feuerwehr-Admin with 2 direct memberships sees exactly those 2 FEUERWEHR scopes:',
    multiFeuerwehrScopes.length === 2 &&
      multiFeuerwehrScopes.every((s) => s.level === 'FEUERWEHR') &&
      twoFeuerwehren.every((f) => multiFeuerwehrScopes.some((s) => (s as { organizationId: string }).organizationId === f.id)),
  );

  // Abschnittsadmin: sees their Abschnitt + its Feuerwehren, no other Abschnitt.
  const someAbschnitt = await prisma.organization.findFirstOrThrow({ where: { type: 'ABSCHNITTSKOMMANDO' } });
  const feuerwehrenUnderIt = await prisma.organization.count({ where: { parentId: someAbschnitt.id } });
  const abschnittAdmin = fakeUser({
    abschnittAdminOrgIds: [someAbschnitt.id],
    feuerwehrAdminOrgIds: [someAbschnitt.id], // build-session-user.ts includes the Abschnitt's own org id too
  });
  const abschnittScopes = await getReachableScopes(abschnittAdmin);
  console.log(
    'Abschnittsadmin sees exactly 1 ABSCHNITT + its Feuerwehren, no BEZIRK:',
    abschnittScopes.filter((s) => s.level === 'BEZIRK').length === 0 &&
      abschnittScopes.filter((s) => s.level === 'ABSCHNITT').length === 1 &&
      abschnittScopes.filter((s) => s.level === 'FEUERWEHR').length === feuerwehrenUnderIt,
  );

  // resolveAdminScope: invalid org is rejected, not silently substituted.
  const reachable: AdminScope[] = feuerwehrScopes;
  const foreignOrgId = 'this-org-does-not-exist-in-reachable';
  const rejected = resolveAdminScope(reachable, 'feuerwehr', foreignOrgId);
  console.log('resolveAdminScope rejects a foreign org id:', rejected.requestedButUnreachable === true);
  console.log('resolveAdminScope falls back to a reachable scope on rejection:', reachable.includes(rejected.scope));

  // resolveAdminScope: valid org resolves correctly.
  const accepted = resolveAdminScope(reachable, 'feuerwehr', someFeuerwehr.id);
  console.log(
    'resolveAdminScope accepts a real reachable org:',
    accepted.requestedButUnreachable === false && accepted.scope === reachable[0],
  );

  // resolveAdminScope: no param at all falls back without complaint.
  const noParam = resolveAdminScope(reachable, undefined, undefined);
  console.log('resolveAdminScope with no param does not flag unreachable:', noParam.requestedButUnreachable === false);
}

main().finally(() => prisma.$disconnect());
```

Run: `npx tsx scripts-tmp-verify-scope.ts` - all lines must print `true`. Delete the script afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/scope.ts
git commit -m "Verwaltung: getReachableScopes/resolveAdminScope fuer Geltungsbereich-Waehler"
```

---

### Task 2: `GeltungsbereichSelector` component + desktop wiring (`AdminSidebar`)

**Files:**
- Create: `src/components/admin/geltungsbereich-selector.tsx`
- Modify: `src/components/admin/admin-sidebar.tsx`

**Interfaces:**
- Consumes: `AdminScope`, `resolveAdminScope` from Task 1 (`@/lib/admin/scope`).
- Produces: `GeltungsbereichSelector({ reachable: AdminScope[] })` - a self-contained client
  component; renders `null` when `reachable.length <= 1`.

- [ ] **Step 1: Write `geltungsbereich-selector.tsx`**

```tsx
'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { resolveAdminScope, type AdminScope } from '@/lib/admin/scope';

const STORAGE_KEY = 'admin-scope';
const BEZIRK_LABEL = 'Bezirk 17 St. Pölten';

function scopeToParams(scope: AdminScope): { ebene: string; org?: string } {
  if (scope.level === 'BEZIRK') return { ebene: 'bezirk' };
  return { ebene: scope.level === 'ABSCHNITT' ? 'abschnitt' : 'feuerwehr', org: scope.organizationId };
}

function scopeLabel(scope: AdminScope): string {
  return scope.level === 'BEZIRK' ? BEZIRK_LABEL : scope.name;
}

function scopeContextLine(scope: AdminScope, reachable: AdminScope[]): string {
  if (scope.level === 'BEZIRK') {
    const abschnitte = reachable.filter((s) => s.level === 'ABSCHNITT').length;
    const feuerwehren = reachable.filter((s) => s.level === 'FEUERWEHR').length;
    return `${abschnitte} Abschnitte · ${feuerwehren} Feuerwehren`;
  }
  if (scope.level === 'ABSCHNITT') {
    const feuerwehren = reachable.filter(
      (s) => s.level === 'FEUERWEHR' && s.abschnittOrganizationId === scope.organizationId,
    ).length;
    return `${feuerwehren} Feuerwehr${feuerwehren === 1 ? '' : 'en'}`;
  }
  return '';
}

function isSameScope(a: AdminScope, b: AdminScope): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 'BEZIRK') return true;
  return (a as { organizationId: string }).organizationId === (b as { organizationId: string }).organizationId;
}

function GeltungsbereichSelectorInner({ reachable }: { reachable: AdminScope[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const rawEbene = searchParams.get('ebene') ?? undefined;
  const rawOrg = searchParams.get('org') ?? undefined;
  const { scope: current } = useMemo(
    () => resolveAdminScope(reachable, rawEbene, rawOrg),
    [reachable, rawEbene, rawOrg],
  );

  function navigateTo(scope: AdminScope) {
    const params = new URLSearchParams(searchParams.toString());
    const next = scopeToParams(scope);
    params.set('ebene', next.ebene);
    if (next.org) {
      params.set('org', next.org);
    } else {
      params.delete('org');
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  // Erststart ohne Parameter: zuletzt gewählte Ebene aus localStorage übernehmen, falls noch
  // erreichbar - stellt eine kanonische, teilbare URL her, statt den impliziten Fallback (erster
  // Eintrag von resolveAdminScope) nur unsichtbar im Hintergrund zu verwenden.
  useEffect(() => {
    if (rawEbene) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as { ebene?: string; org?: string };
      const resolved = resolveAdminScope(reachable, stored.ebene, stored.org);
      if (!resolved.requestedButUnreachable) {
        navigateTo(resolved.scope);
      }
    } catch {
      // Ungültiger localStorage-Inhalt - der bestehende Fallback bleibt einfach bestehen.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reachable.length <= 1) {
    return null;
  }

  const bezirk = reachable.find((s) => s.level === 'BEZIRK');
  const abschnitte = reachable.filter((s): s is Extract<AdminScope, { level: 'ABSCHNITT' }> => s.level === 'ABSCHNITT');
  const feuerwehren = reachable.filter((s): s is Extract<AdminScope, { level: 'FEUERWEHR' }> => s.level === 'FEUERWEHR');

  const query = search.trim().toLowerCase();
  const bezirkMatches = Boolean(bezirk) && BEZIRK_LABEL.toLowerCase().includes(query);
  const filteredAbschnitte = abschnitte.filter((s) => s.name.toLowerCase().includes(query));
  const filteredFeuerwehren = feuerwehren.filter((s) => s.name.toLowerCase().includes(query));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[58px] w-full flex-col items-start justify-center border-b border-line bg-surface px-3.5 text-left hover:bg-surface-sunken"
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">{scopeLabel(current)}</span>
            <span aria-hidden className="text-ink-faint">
              {open ? '▴' : '▾'}
            </span>
          </span>
          <span className="text-[13px] text-ink-faint">{scopeContextLine(current, reachable)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-0 shadow-[0_10px_28px_rgba(28,28,30,.14)]">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty className="py-4 text-sm text-ink-faint">Keine Treffer.</CommandEmpty>
            {bezirk && bezirkMatches && (
              <CommandGroup>
                <CommandItem
                  value="__bezirk__"
                  onSelect={() => navigateTo(bezirk)}
                  className={isSameScope(current, bezirk) ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                >
                  {BEZIRK_LABEL}
                </CommandItem>
              </CommandGroup>
            )}
            {filteredAbschnitte.length > 0 && (
              <CommandGroup heading="Abschnitte">
                {filteredAbschnitte.map((scope) => (
                  <CommandItem
                    key={scope.organizationId}
                    value={scope.organizationId}
                    onSelect={() => navigateTo(scope)}
                    className={`pl-6 ${isSameScope(current, scope) ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}`}
                  >
                    {scope.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredFeuerwehren.length > 0 && (
              <CommandGroup heading="Feuerwehren">
                {filteredFeuerwehren.map((scope) => (
                  <CommandItem
                    key={scope.organizationId}
                    value={scope.organizationId}
                    onSelect={() => navigateTo(scope)}
                    className={`pl-6 ${isSameScope(current, scope) ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}`}
                  >
                    {scope.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * useSearchParams() braucht laut Next.js einen Suspense-Grenzwert. Jede andere URL-Sync-Komponente
 * in dieser Codebase (z. B. user-management-section.tsx) bekommt ihren Anfangswert stattdessen als
 * Prop von einer page.tsx, die searchParams selbst liest - das geht hier nicht, da AdminSidebar vom
 * Layout gerendert wird, das gar kein searchParams erhält (siehe Design-Spec §2). Der
 * Suspense-Wrapper lebt hier, nicht bei jedem Aufrufer, damit niemand vergisst, ihn zu setzen.
 */
export function GeltungsbereichSelector({ reachable }: { reachable: AdminScope[] }) {
  return (
    <Suspense fallback={null}>
      <GeltungsbereichSelectorInner reachable={reachable} />
    </Suspense>
  );
}
```

- [ ] **Step 2: Wire into `admin-sidebar.tsx`**

Replace the full file content:

```tsx
import Link from 'next/link';
import { getAdminSidebarStatus } from '@/lib/system/system-check';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import type { SessionUser } from '@/types/next-auth';
import { AdminSidebarNav } from './admin-sidebar-nav';
import { GeltungsbereichSelector } from './geltungsbereich-selector';

const STATUS_ROWS = [
  { key: 'database', label: 'Datenbank' },
  { key: 'mailjet', label: 'Mailjet' },
  { key: 'ntp', label: 'Zeitserver' },
] as const;

/** Verwaltung-Brief.md: feste linke Sidebar (210px, nur ab md:) statt der bisherigen horizontalen
 * AdminNav-Pillreihe. Server Component - liest den Status direkt serverseitig
 * (getAdminSidebarStatus ist selbst 60s gecacht, siehe system-check.ts), nur die Link-Liste
 * braucht als Client-Unterkomponente usePathname für den aktiven Zustand. user wird von
 * admin/layout.tsx durchgereicht, seit die Nav-Items berechtigungsabhängig sind (Heimatfeuerwehr-
 * Admins ohne Site-Admin-Recht sehen hier nur "Heimatfeuerwehr").
 *
 * Geltungsbereich-Wähler (Verwaltung-Filter-Brief.md §2): sitzt bewusst AUSSERHALB des
 * gepolsterten Innenbereichs, randlos über der gesamten Sidebar-Breite mit eigener Hairline -
 * deshalb wanderte das bisherige py-6/pl-3.5/pr-3.5 vom <aside> selbst auf einen inneren <div>.
 * GeltungsbereichSelector rendert selbst `null`, wenn reachable.length <= 1 ist (z. B. ein
 * Feuerwehr-Admin mit nur seiner Heimatwehr) - keine eigene Bedingung hier nötig. */
export async function AdminSidebar({ user }: { user: SessionUser }) {
  const [status, reachableScopes] = await Promise.all([getAdminSidebarStatus(), getReachableScopes(user)]);
  const items = getAdminNavItems(user);

  return (
    <aside className="hidden shrink-0 border-r border-line md:block md:w-[210px]">
      <GeltungsbereichSelector reachable={reachableScopes} />
      <div className="py-6 pl-3.5 pr-3.5">
        <span className="mb-3 block px-3 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">
          Verwaltung
        </span>
        <AdminSidebarNav items={items} />
        <Link
          href="/admin/status"
          className="mt-6 flex flex-col gap-2 border-t border-line pt-4 hover:opacity-80"
        >
          {STATUS_ROWS.map((row) => (
            <span key={row.key} className="flex items-center gap-2 px-3 text-xs text-ink-muted">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${status[row.key] ? 'bg-success' : 'bg-danger'}`}
              />
              {row.label}
            </span>
          ))}
        </Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Verify with `tsc`**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Live verification against the dev server**

Start the dev server, log in as the seeded Bezirksadmin, navigate to `/admin/benutzer` at a
desktop viewport (≥768px). Confirm:
- The selector renders above "Verwaltung" in the sidebar, showing "Bezirk 17 St. Pölten" and
  "7 Abschnitte · 124 Feuerwehren" (or whatever the live counts are).
- Opening it shows a searchable tree with Abschnitte and Feuerwehren grouped separately.
- Selecting an Abschnitt updates the URL to `?ebene=abschnitt&org=<id>` and the closed-state label
  updates to that Abschnitt's name with its Feuerwehren count.
- Reloading the page keeps the selection (URL param survives).
- Manually editing the URL to `?ebene=feuerwehr&org=does-not-exist` and reloading falls back to a
  real reachable scope instead of crashing or showing a blank state.
- After selecting an Abschnitt, navigating to the bare `/admin/benutzer` URL (no `?ebene=&org=` at
  all - e.g. by clicking the sidebar's own "Benutzerverwaltung" link, which points at that bare
  path) re-adds the previously selected Abschnitt's params automatically (the `useEffect` reading
  `localStorage` on mount) rather than resetting to the default Bezirk-level fallback.

Log in as a plain Feuerwehr-Admin with exactly one Feuerwehr (or check `feuerwehrAdminOrgIds`
directly against a seeded user) and confirm the selector row is entirely absent - the sidebar's
"Verwaltung" label sits directly at the top with no gap where the selector would have been.

Because this browser-automation environment does not reliably hydrate Radix Popover content (a
pre-existing, extensively documented limitation of this environment - see CLAUDE.md), the popover's
actual open/click interaction may not be exercisable live; verify what you can (rendering, closed-
state label/context line, URL-driven state via direct navigation to a `?ebene=&org=` URL) and note
explicitly in your report anything that could not be click-tested for this reason, exactly as prior
phases in this codebase have done.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/geltungsbereich-selector.tsx src/components/admin/admin-sidebar.tsx
git commit -m "Verwaltung: Geltungsbereich-Waehler in der Desktop-Sidebar"
```

---

### Task 3: Mobile wiring across the 5 existing `/admin/*` pages

**Files:**
- Modify: `src/app/(app)/admin/drohnen/page.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
- Modify: `src/app/(app)/admin/email/page.tsx`
- Modify: `src/app/(app)/admin/status/page.tsx`
- Modify: `src/app/(app)/admin/benutzer/page.tsx`
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx`

**Interfaces:**
- Consumes: `getReachableScopes` (Task 1), `GeltungsbereichSelector` (Task 2).

Four of these five pages share an identical pattern (`AdminMobileTabs` rendered directly in the
page's own JSX, right after `const user = await requireUser();`). `benutzer/page.tsx` is the
exception - it renders `AdminMobileTabs` inside the client component `UserManagementSection`, fed
via a prop, so it needs one extra prop threaded through instead.

- [ ] **Step 1: `admin/drohnen/page.tsx`**

Add to the imports (after the existing `import { getAdminNavItems } from '@/lib/admin/nav-items';`
line):

```typescript
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
```

Right after the existing `const user = await requireUser();` line, add:

```typescript
  const reachableScopes = await getReachableScopes(user);
```

Replace:

```tsx
      <AdminMobileTabs items={getAdminNavItems(user)} />
```

with:

```tsx
      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />
```

- [ ] **Step 2: `admin/heimatfeuerwehr/page.tsx`**

Same three edits as Step 1 (import, `reachableScopes` right after `const user = await
requireUser();`, and the same replacement of the `<AdminMobileTabs items={getAdminNavItems(user)}
/>` line with the `<div className="md:hidden">` wrapper followed by that same line).

- [ ] **Step 3: `admin/email/page.tsx`**

Same three edits as Step 1.

- [ ] **Step 4: `admin/status/page.tsx`**

Same three edits as Step 1.

- [ ] **Step 5: `admin/benutzer/page.tsx` + `user-management-section.tsx`**

In `admin/benutzer/page.tsx`, add to the imports (after the existing `import { getAdminNavItems }
from '@/lib/admin/nav-items';` line):

```typescript
import { getReachableScopes } from '@/lib/admin/scope';
```

Add a new line right after `const viewerIsBezirksDrohnenAdmin = currentUser.isBezirksDrohnenAdmin;`:

```typescript
  const reachableScopes = await getReachableScopes(currentUser);
```

In the `<UserManagementSection ... />` call, add a new prop right after the existing
`adminNavItems={getAdminNavItems(currentUser)}` line:

```tsx
      reachableScopes={reachableScopes}
```

In `user-management-section.tsx`:

Add the import (alongside the existing `import { AdminMobileTabs } from
'@/components/admin/admin-mobile-tabs';` line):

```typescript
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import type { AdminScope } from '@/lib/admin/scope';
```

Add `reachableScopes,` to the destructured prop list (the block starting `export function
UserManagementSection({`), right after the existing `adminNavItems,` entry, and add
`reachableScopes: AdminScope[];` to the accompanying type-annotation object, right after the
existing `adminNavItems: AdminNavItem[];` line.

Replace:

```tsx
      <AdminMobileTabs items={adminNavItems} />
```

with:

```tsx
      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={adminNavItems} />
```

- [ ] **Step 6: Verify with `tsc` and `npm run build`**

```bash
npx tsc --noEmit
npm run build
```
Both must be clean.

- [ ] **Step 7: Live verification against the dev server**

At a mobile viewport (<768px), log in as the seeded Bezirksadmin and confirm the selector appears
above the horizontal pill nav on all 5 pages (`/admin/benutzer`, `/admin/drohnen`,
`/admin/heimatfeuerwehr`, `/admin/email`, `/admin/status`) with the same closed-state
label/behavior as the desktop sidebar version, and that selecting a different scope on one page
keeps it selected when navigating to another `/admin/*` page (since the URL param carries the
selection, and localStorage carries it across a fresh visit with no param). Confirm again that a
Feuerwehr-Admin with exactly one Feuerwehr sees no selector on any of the 5 pages, mobile or
desktop.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/admin/drohnen/page.tsx" "src/app/(app)/admin/heimatfeuerwehr/page.tsx" "src/app/(app)/admin/email/page.tsx" "src/app/(app)/admin/status/page.tsx" "src/app/(app)/admin/benutzer/page.tsx" "src/app/(app)/admin/benutzer/user-management-section.tsx"
git commit -m "Verwaltung: Geltungsbereich-Waehler auf allen 5 Admin-Seiten (Mobile)"
```
