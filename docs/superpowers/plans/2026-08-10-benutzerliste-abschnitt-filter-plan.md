# Benutzerliste: Abschnitt-Filter + durchsuchbarer Feuerwehr-Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Abschnitt filter (Bezirksadmin-only, pre-filled from the Geltungsbereich-Wähler) to
`/admin/benutzer`, and upgrade its existing flat Feuerwehr `<Select>` (unusable at ~124 entries) to a
searchable Popover+Command single-select.

**Architecture:** A new, generic `OrgSearchSelect` client component (single-select sibling of the
existing `AdminOrgMultiSelect`) replaces the Feuerwehr `<Select>` and backs the new Abschnitt filter.
`groupByAbschnitt`, currently duplicated in two files, is extracted to a shared util as the third real
consumer arrives. `page.tsx` derives the Abschnitt filter's initial value from the already-computed
Geltungsbereich (via `resolveAdminScope`) when no explicit `?abschnitt=` param is present - entirely
server-side, no new client hook needed.

**Tech Stack:** Next.js App Router, existing shadcn `Popover`/`Command` primitives, no new dependencies.

## Global Constraints

- No server-side filtering/pagination - the `users` Prisma query in `page.tsx` stays unfiltered;
  all filtering remains client-side, exactly as today.
- No Drohnengruppe filter, no Rolle-tier expansion, no new Abschnittsliste page - all separate,
  later specs.
- The new `?abschnitt=` query param is page-local to `/admin/benutzer` - it must not collide with
  the global `?ebene=`/`?bereich=` Geltungsbereich params or with `/admin/heimatfeuerwehr`'s own
  `?org=` (different page, different namespace - no actual conflict, just don't reuse the name `org`).
- Explicit `?abschnitt=<id>` in the URL always wins over the Geltungsbereich-derived default.
- `OrgSearchSelect` must be generic enough to be reused by a future Abschnittsliste/
  Drohnengruppenliste - do not hardcode anything Benutzerliste-specific into it.
- There is no test suite in this repo. Verify each task via `npx tsc --noEmit`, live checks against
  the dev server (raw SSR HTML if the browser-automation environment's documented CSP/hydration
  limitation blocks interactive checking), and (final task) `npm run build`.

---

### Task 1: `groupByAbschnitt` extraction + `OrgSearchSelect` component

**Files:**
- Create: `src/lib/admin/group-by-abschnitt.ts`
- Create: `src/components/admin/org-search-select.tsx`
- Modify: `src/components/admin/admin-org-multiselect.tsx`
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx`

**Interfaces:**
- Produces: `groupByAbschnitt<T extends {abschnittName?: string}>(items: T[]): Record<string, T[]>`;
  `OrgSearchSelectOption { id: string; name: string; abschnittName?: string }`; `OrgSearchSelect({
  options, value, onChange, placeholder, allLabel, allValue? })`.

- [ ] **Step 1: `src/lib/admin/group-by-abschnitt.ts`**

```typescript
/** Gruppiert eine Liste von Organisationen nach ihrem Abschnitt (abschnittName) - mit bis zu 124
 * Feuerwehren (Bezirksadmin) ist eine flache Liste sonst unbrauchbar. Orgs ohne abschnittName (z. B.
 * ein Feuerwehr-Admin mit 1-2 Optionen, oder ein Abschnitt selbst) landen unter "Ohne Abschnitt".
 * Gemeinsam genutzt von AdminOrgMultiSelect, OrgSearchSelect und UserManagementSection - vorher an
 * zwei Stellen fast identisch dupliziert. */
export function groupByAbschnitt<T extends { abschnittName?: string }>(organizations: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const org of organizations) {
    const key = org.abschnittName ?? 'Ohne Abschnitt';
    (groups[key] ??= []).push(org);
  }
  return groups;
}
```

- [ ] **Step 2: `src/components/admin/org-search-select.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { groupByAbschnitt } from '@/lib/admin/group-by-abschnitt';

export interface OrgSearchSelectOption {
  id: string;
  name: string;
  abschnittName?: string;
}

/**
 * Einzelauswahl-Geschwister von AdminOrgMultiSelect - gleiche Popover+Command-Bauweise, gleiches
 * "nach Abschnitt gruppiert"-Verhalten, aber ein einzelner gewählter Wert statt eines Arrays.
 * Geschlossen zeigt der Trigger entweder den gewählten Namen oder `allLabel` (z. B. "Alle
 * Feuerwehren") - anders als AdminOrgMultiSelects "N von M ausgewählt", da hier höchstens ein
 * Eintrag gewählt sein kann.
 */
export function OrgSearchSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  allValue = 'ALLE',
}: {
  options: OrgSearchSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  allLabel: string;
  allValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => options.find((org) => org.id === value), [options, value]);
  const hasAbschnittGroups = options.some((org) => Boolean(org.abschnittName));
  const filteredOptions = useMemo(
    () => options.filter((org) => org.name.toLowerCase().includes(search.trim().toLowerCase())),
    [options, search],
  );

  function select(id: string) {
    onChange(id);
    setSearch('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-sm transition-colors ${
            open ? 'border-2 border-brand px-[11px]' : 'border-line'
          }`}
        >
          <span className={selected ? 'text-ink' : 'text-ink-faint'}>{selected ? selected.name : allLabel}</span>
          <span className="flex-none text-ink-faint">{open ? '▴' : '▾'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[220px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`${placeholder} suchen …`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty className="py-4 text-sm text-ink-faint">Keine Treffer.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allValue}
                onSelect={() => select(allValue)}
                className={value === allValue ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
              >
                {allLabel}
              </CommandItem>
            </CommandGroup>
            {Object.entries(groupByAbschnitt(filteredOptions)).map(([abschnittName, orgs]) => (
              <CommandGroup key={abschnittName} heading={hasAbschnittGroups ? abschnittName : undefined}>
                {orgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={org.id}
                    onSelect={() => select(org.id)}
                    className={value === org.id ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                  >
                    {org.name}
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

- [ ] **Step 3: `admin-org-multiselect.tsx` - use the shared util**

Replace:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';

interface OrgOption {
  id: string;
  name: string;
  abschnittName?: string;
}

/** Gruppiert die (bereits durchsuchte) Feuerwehr-Liste nach Abschnitt, dieselbe Begründung wie
 * OrgSelect/groupByAbschnitt/groupOrganizationsByAbschnitt an den anderen drei Feuerwehr-Auswahlstellen
 * dieser Codebase: mit bis zu 124 Feuerwehren (Bezirksadmin) ist eine flache Liste sonst unbrauchbar. */
function groupByAbschnitt(organizations: OrgOption[]): Record<string, OrgOption[]> {
  const groups: Record<string, OrgOption[]> = {};
  for (const org of organizations) {
    const key = org.abschnittName ?? 'Ohne Abschnitt';
    (groups[key] ??= []).push(org);
  }
  return groups;
}
```

with:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { groupByAbschnitt } from '@/lib/admin/group-by-abschnitt';

interface OrgOption {
  id: string;
  name: string;
  abschnittName?: string;
}
```

(the rest of the file, which calls `groupByAbschnitt(filteredOrgs)`, is unchanged - only the import
and the now-deleted local function definition change).

- [ ] **Step 4: `user-management-section.tsx` - use the shared util**

Replace the local function (currently around lines 77-88):
```tsx
/** Gruppiert Feuerwehren nach Abschnitt für <optgroup>-artige Darstellung in den Feuerwehr-Selects/
 * -Dropdowns dieser Seite - mit bis zu 124 Feuerwehren (Bezirksadmin) ist eine flache Liste sonst
 * unbrauchbar. Orgs ohne abschnittName (z. B. ein Feuerwehr-Admin mit 1-2 Optionen) landen unter
 * "Ohne Abschnitt". */
function groupByAbschnitt<T extends { abschnittName?: string }>(organizations: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const org of organizations) {
    const key = org.abschnittName ?? 'Ohne Abschnitt';
    (groups[key] ??= []).push(org);
  }
  return groups;
}
```
with nothing (delete it entirely), and add an import for the shared version alongside the file's
other `@/lib/admin/...` imports:
```typescript
import { groupByAbschnitt } from '@/lib/admin/group-by-abschnitt';
```
Every existing call site (`groupByAbschnitt(organizations)` in the Feuerwehr `<Select>` and the bulk
"Feuerwehr ändern" dropdown) stays exactly as-is - only the import source changes. Do NOT touch the
Feuerwehr `<Select>`/filter logic in this task - that is Task 2's job.

- [ ] **Step 5: Verify with `tsc`**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Live verification**

Start the dev server, log in as the seeded Bezirksadmin, and confirm two things still render
identically to before this change (since the extraction must be behavior-preserving):
1. `/admin/benutzer`'s Feuerwehr `<Select>` still groups options by Abschnitt correctly.
2. Opening the "Admin für" field in `UserFormSheet` (edit any user) still shows `AdminOrgMultiSelect`
   grouped by Abschnitt correctly.

`OrgSearchSelect` itself has no consumer yet in this task - it cannot be live-verified in the running
app until Task 2 wires it in. A code-level self-check is sufficient here: confirm it type-checks and
its JSX structure mirrors `AdminOrgMultiSelect`'s already-working pattern closely enough that no
runtime issue is expected (same `Popover`/`Command` primitives, same grouping call, single-value
selection instead of an array).

- [ ] **Step 7: Commit**

```bash
git add src/lib/admin/group-by-abschnitt.ts src/components/admin/org-search-select.tsx src/components/admin/admin-org-multiselect.tsx "src/app/(app)/admin/benutzer/user-management-section.tsx"
git commit -m "Verwaltung: OrgSearchSelect-Komponente + groupByAbschnitt-Extraktion"
```

---

### Task 2: Abschnitt-Filter + Feuerwehr-Filter-Umstellung in der Benutzerliste

**Files:**
- Modify: `src/app/(app)/admin/benutzer/page.tsx`
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx`

**Interfaces:**
- Consumes: `OrgSearchSelect`/`groupByAbschnitt` (Task 1), `resolveAdminScope`/`getReachableScopes`
  (already exist from the Geltungsbereich-Wähler feature).
- Produces: `UserManagementSection` gains `initialAbschnitt: string` and `abschnitte: {id: string;
  name: string}[]` props; `Organization` (the local prop interface) gains `abschnittId?: string`.

- [ ] **Step 1: `page.tsx` - resolve the initial Abschnitt filter server-side**

Change the import line that currently reads `import { getReachableScopes } from '@/lib/admin/scope';`
to also import `resolveAdminScope`:
```typescript
import { getReachableScopes, resolveAdminScope } from '@/lib/admin/scope';
```

Change the `organizations` query's `parent` select (currently `include: { parent: { select: {
shortName: true, name: true } } }`) to also select `id`:
```typescript
      include: { parent: { select: { id: true, shortName: true, name: true } } },
```

Right after the existing `const reachableScopes = await getReachableScopes(currentUser);` line, add:
```typescript
  let initialAbschnitt = params.abschnitt ?? '';
  if (fullAdmin && !initialAbschnitt) {
    const scopeResolution = resolveAdminScope(reachableScopes, params.ebene, params.bereich);
    if (scopeResolution.scope.level === 'ABSCHNITT') {
      initialAbschnitt = scopeResolution.scope.organizationId;
    }
  }
```

In the `organizations.map(...)` call inside the `<UserManagementSection>` JSX, add `abschnittId` to
the mapped object, right after the existing `abschnittName` line:
```tsx
      organizations={organizations.map((org) => ({
        id: org.id,
        name: org.shortName ?? org.name,
        abschnittName: org.parent?.shortName ?? org.parent?.name,
        abschnittId: org.parent?.id,
      }))}
```

Add two new props to the `<UserManagementSection>` call, right after the existing
`reachableScopes={reachableScopes}` line:
```tsx
      initialAbschnitt={initialAbschnitt}
      abschnitte={reachableScopes
        .filter((scope) => scope.level === 'ABSCHNITT')
        .map((scope) => ({ id: scope.organizationId, name: scope.name }))}
```

- [ ] **Step 2: `user-management-section.tsx` - add the Abschnitt filter, wire the dependency, swap the Feuerwehr select**

Add the import (alongside the other `@/components/admin/...` imports):
```typescript
import { OrgSearchSelect } from '@/components/admin/org-search-select';
```

Extend the `Organization` interface (currently `{ id: string; name: string; abschnittName?: string;
}`), adding one field:
```typescript
interface Organization {
  id: string;
  name: string;
  abschnittName?: string;
  abschnittId?: string;
}
```

Add `initialAbschnitt` and `abschnitte` to the destructured prop list (right after the existing
`reachableScopes,` entry) and to the accompanying type-annotation object (right after the existing
`reachableScopes: AdminScope[];` entry):
```typescript
  initialAbschnitt,
  abschnitte,
```
```typescript
  initialAbschnitt: string;
  abschnitte: { id: string; name: string }[];
```

Add new state, right after the existing `const [feuerwehr, setFeuerwehr] = useState(initialFeuerwehr
|| 'ALLE');` line:
```typescript
  const [abschnitt, setAbschnitt] = useState(initialAbschnitt || 'ALLE');
```

Add a helper right after the state declarations (near `toggleSort`/similar small handlers):
```typescript
  function handleAbschnittChange(value: string) {
    setAbschnitt(value);
    setFeuerwehr('ALLE');
  }

  const feuerwehrOptions = useMemo(
    () => (abschnitt === 'ALLE' ? organizations : organizations.filter((org) => org.abschnittId === abschnitt)),
    [organizations, abschnitt],
  );
```

Update the `filtered` `useMemo` (currently reads `if (feuerwehr !== 'ALLE' && ...)` first) to also
scope by Abschnitt, reusing `feuerwehrOptions` as the membership test rather than re-deriving it:
```typescript
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const abschnittOrgIds = abschnitt === 'ALLE' ? null : new Set(feuerwehrOptions.map((o) => o.id));
    return users.filter((u) => {
      if (abschnittOrgIds && !abschnittOrgIds.has(u.homeOrganizationId)) return false;
      if (feuerwehr !== 'ALLE' && u.homeOrganizationId !== feuerwehr) return false;
      if (rolle === 'JA' && !u.isAdmin) return false;
      if (rolle === 'NEIN' && u.isAdmin) return false;
      if (status !== 'ALLE' && getUserStatus(u) !== status) return false;
      if (!q) return true;
      return [u.name, u.email, u.stbNr, u.phone, u.homeOrg, u.adminFor, u.droneLabel].some((field) =>
        field.toLowerCase().includes(q),
      );
    });
  }, [users, query, abschnitt, feuerwehrOptions, feuerwehr, rolle, status]);
```

Update the URL-sync effect: add `abschnitt` to the dependency array and write it to the params right
before the existing `feuerwehr` line:
```typescript
  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of ['ebene', 'bereich']) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    if (query) params.set('q', query);
    if (abschnitt !== 'ALLE') params.set('abschnitt', abschnitt);
    if (feuerwehr !== 'ALLE') params.set('feuerwehr', feuerwehr);
    if (rolle !== 'ALLE') params.set('rolle', rolle);
    if (status !== 'ALLE') params.set('status', status);
    if (sortKey !== 'name') params.set('sort', sortKey);
    if (sortDir !== 'asc') params.set('dir', sortDir);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, abschnitt, feuerwehr, rolle, status, sortKey, sortDir, searchParams]);
```

Update `activeFilterCount`:
```typescript
  const activeFilterCount = [abschnitt !== 'ALLE', feuerwehr !== 'ALLE', rolle !== 'ALLE', status !== 'ALLE'].filter(
    Boolean,
  ).length;
```

Update `resetFilters()`:
```typescript
  function resetFilters() {
    setAbschnitt('ALLE');
    setFeuerwehr('ALLE');
    setRolle('ALLE');
    setStatus('ALLE');
  }
```

Replace the `filterControls` variable's body (currently starting with the Feuerwehr `<Select>`) so it
reads, in full:
```tsx
  const filterControls = (
    <>
      {isFullAdmin && (
        <OrgSearchSelect
          options={abschnitte}
          value={abschnitt}
          onChange={handleAbschnittChange}
          placeholder="Abschnitt"
          allLabel="Alle Abschnitte"
        />
      )}

      <OrgSearchSelect
        options={feuerwehrOptions}
        value={feuerwehr}
        onChange={setFeuerwehr}
        placeholder="Feuerwehr"
        allLabel="Alle Feuerwehren"
      />

      <Select value={rolle} onValueChange={(value) => setRolle(value as SimpleFilter)}>
        <SelectTrigger className="w-full md:w-auto">
          <SelectValue placeholder="Rolle" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALLE">Alle Rollen</SelectItem>
          <SelectItem value="JA">Admin</SelectItem>
          <SelectItem value="NEIN">Mitglied</SelectItem>
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
        <SelectTrigger className="w-full md:w-auto">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALLE">Alle Status</SelectItem>
          <SelectItem value="AKTIV">Aktiv</SelectItem>
          <SelectItem value="INAKTIV">Inaktiv</SelectItem>
          <SelectItem value="DEAKTIVIERT">Deaktiviert</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex flex-wrap items-center gap-2.5">
        {abschnitt !== 'ALLE' && (
          <button
            type="button"
            onClick={() => handleAbschnittChange('ALLE')}
            className="flex items-center gap-1 rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink-muted hover:bg-line"
          >
            {abschnitte.find((a) => a.id === abschnitt)?.name ?? 'Abschnitt'} ✕
          </button>
        )}
        {feuerwehr !== 'ALLE' && (
          <button
            type="button"
            onClick={() => setFeuerwehr('ALLE')}
            className="flex items-center gap-1 rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink-muted hover:bg-line"
          >
            {organizations.find((o) => o.id === feuerwehr)?.name ?? 'Feuerwehr'} ✕
          </button>
        )}
        {rolle !== 'ALLE' && (
          <button
            type="button"
            onClick={() => setRolle('ALLE')}
            className="flex items-center gap-1 rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink-muted hover:bg-line"
          >
            {rolle === 'JA' ? 'Admin' : 'Mitglied'} ✕
          </button>
        )}
        {status !== 'ALLE' && (
          <button
            type="button"
            onClick={() => setStatus('ALLE')}
            className="flex items-center gap-1 rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink-muted hover:bg-line"
          >
            {STATUS_LABEL[status as UserStatus]} ✕
          </button>
        )}
        {activeFilterCount > 1 && (
          <button type="button" onClick={resetFilters} className="text-xs font-medium text-brand hover:underline">
            Alle zurücksetzen
          </button>
        )}
      </div>
    </>
  );
```

Then replace the ENTIRE desktop-only duplicate block (currently the `<div className="hidden
flex-wrap items-center gap-2.5 md:flex">` block containing its own separately-written copies of the
Feuerwehr/Rolle/Status `<Select>`s and chip buttons - the block right after the search `<Input>` and
before the `{someVisibleSelected && (...)}` bulk-actions bar) with:
```tsx
      <div className="hidden flex-wrap items-center gap-2.5 md:flex">{filterControls}</div>
```
This removes the pre-existing duplication (a comment above `filterControls` already incorrectly
claimed the desktop row reused it) - both desktop and the mobile Bottom Sheet now render the exact
same `filterControls` expression.

- [ ] **Step 3: Verify with `tsc` and `npm run build`**

```bash
npx tsc --noEmit
npm run build
```
Both must be clean - this is the last task in the plan.

- [ ] **Step 4: Live verification**

Start the dev server (or reuse one already running for this worktree). Log in as the seeded
Bezirksadmin and confirm, via the running app (using direct URL navigation / raw SSR HTML inspection
if the browser-automation environment's documented CSP/hydration limitation blocks interactive
Popover click-testing, exactly as prior phases in this codebase have done):

1. The Abschnitt filter renders on `/admin/benutzer` for the Bezirksadmin.
2. Navigating directly to `/admin/benutzer?abschnitt=<a real Abschnitt id>` shows only users whose
   home organization is that Abschnitt or one of its Feuerwehren, and the Feuerwehr filter's option
   list is scoped to that Abschnitt.
3. Navigating to `/admin/benutzer?ebene=abschnitt&bereich=<the same Abschnitt id>` (no explicit
   `?abschnitt=`) produces the SAME scoped result - confirming the Geltungsbereich pre-fill works.
4. Navigating to `/admin/benutzer?ebene=abschnitt&bereich=<Abschnitt A>&abschnitt=<Abschnitt B>`
   (both present) scopes to Abschnitt B - confirming the explicit param wins.
5. Query a seeded Feuerwehr-only admin (or construct one via a temporary DB script) and confirm the
   Abschnitt filter is entirely absent from their rendered page.
6. Confirm the desktop (`md:` and up simulated via viewport or by inspecting the `hidden
   ... md:flex` wrapper's rendered content) and mobile (`md:hidden` Bottom Sheet trigger) filter rows
   render identical content - both now sourced from the same `filterControls` expression.

Clean up any temporary test data/users created for step 5 afterward.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/benutzer/page.tsx" "src/app/(app)/admin/benutzer/user-management-section.tsx"
git commit -m "Benutzerverwaltung: Abschnitt-Filter mit Geltungsbereich-Vorbelegung"
```
