'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { UserFormSheet, type UserSheetTarget } from '@/components/admin/user-form-sheet';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import type { AdminScope } from '@/lib/admin/scope';
import type { AdminNavItem } from '@/lib/admin/nav-items';
import { useMobileHeader } from '@/components/layout/mobile-header-context';
import type { DroneRoleOption } from '@/lib/validation/user.schema';
import { formatRelativeDate, isOlderThanMonths } from '@/lib/format';
import { getUserStatus, type UserStatus } from '@/lib/auth/user-status';
import { bulkSetActive, bulkSetHomeOrganization } from './actions';
import { UserRowActions } from './user-row-actions';

export interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  stbNr: string;
  phone: string;
  homeOrg: string;
  homeOrganizationId: string;
  isAdmin: boolean;
  adminFor: string;
  adminOrgIds: string[];
  droneLabel: string;
  droneRole: DroneRoleOption;
  droneGroupId: string | null;
  pushCount: number;
  pushDates: string[];
  isActive: boolean;
  istAtemschutzgeraeteTraeger: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  dienstgradId: string;
  dienstgrad: string;
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
}

type SheetState = { mode: 'create' } | { mode: 'edit'; userId: string };

interface Organization {
  id: string;
  name: string;
  abschnittName?: string;
}

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

interface DienstgradOption {
  id: string;
  kurzform: string;
  bezeichnung: string;
}

type SortKey =
  | 'name'
  | 'email'
  | 'stbNr'
  | 'phone'
  | 'homeOrg'
  | 'adminFor'
  | 'droneLabel'
  | 'pushCount'
  | 'status'
  | 'lastActive'
  | 'dienstgrad';
type SimpleFilter = 'ALLE' | 'JA' | 'NEIN';
type StatusFilter = 'ALLE' | UserStatus;

const STATUS_LABEL: Record<UserStatus, string> = { AKTIV: 'Aktiv', INAKTIV: 'Inaktiv', DEAKTIVIERT: 'Deaktiviert' };
const STATUS_BADGE_CLASS: Record<UserStatus, string> = {
  AKTIV: 'border-transparent bg-success-subtle text-success-text',
  INAKTIV: 'border-transparent bg-warning-subtle text-warning-text',
  DEAKTIVIERT: 'border-transparent bg-danger-subtle text-danger',
};
const STATUS_SORT_RANK: Record<UserStatus, number> = { INAKTIV: 0, DEAKTIVIERT: 1, AKTIV: 2 };

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'dienstgrad', label: 'Dienstgrad' },
  { key: 'email', label: 'E-Mail' },
  { key: 'stbNr', label: 'StbNr' },
  { key: 'phone', label: 'Telefonnummer' },
  { key: 'homeOrg', label: 'Heimat-Feuerwehr' },
  { key: 'adminFor', label: 'Rolle' },
  { key: 'droneLabel', label: 'Drohnengruppe' },
  { key: 'pushCount', label: 'Push' },
  { key: 'status', label: 'Status' },
  { key: 'lastActive', label: 'Zuletzt aktiv' },
];

function compareRows(a: UserRow, b: UserRow, key: SortKey): number {
  switch (key) {
    case 'pushCount':
      return a.pushCount - b.pushCount;
    case 'status':
      return STATUS_SORT_RANK[getUserStatus(a)] - STATUS_SORT_RANK[getUserStatus(b)];
    case 'lastActive':
      return (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0) - (b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0);
    default:
      return a[key].localeCompare(b[key], 'de');
  }
}

function formatPushTooltip(dates: string[]): string {
  if (dates.length === 0) return '';
  return dates.map((d) => `Registriert seit ${new Date(d).toLocaleDateString('de-AT')}`).join('\n');
}

/** Kartenansicht für schmale Bildschirme (Verwaltung-Brief.md 5): "Name fett, darunter
 * 'Feuerwehr · Rolle' 13px, rechts der Status-Badge" - min-h-11 (44px) für die Trefferfläche. */
function UserCard({ user, onSelect }: { user: UserRow; onSelect: (id: string) => void }) {
  const status = getUserStatus(user);
  return (
    <button
      type="button"
      onClick={() => onSelect(user.id)}
      className="flex min-h-11 w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left last:border-0"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-ink">
          {user.dienstgrad && <span className="text-ink-muted">{user.dienstgrad} </span>}
          {user.name}
        </span>
        <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      <span className="text-[13px] text-ink-muted">
        {user.homeOrg} · {user.isAdmin ? 'Admin' : 'Mitglied'}
      </span>
    </button>
  );
}

/** Verwaltung-Brief.md 5: zwei Kennzahlkarten nebeneinander über der mobilen Kartenliste. Zahlen in
 * Barlow Condensed (font-condensed, Phase 1) - laut Brief ausschließlich für Kennzahlen gedacht. */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-lg bg-surface p-4 shadow-card">
      <div className="font-condensed text-3xl font-bold text-ink">{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}

export function UserManagementSection({
  users,
  organizations,
  dienstgrade,
  droneGroups,
  initialQuery,
  initialFeuerwehr,
  initialRolle,
  initialStatus,
  initialSort,
  initialDir,
  currentUserId,
  initialEditUserId,
  initialCreateOpen,
  adminNavItems,
  reachableScopes,
  isFullAdmin,
  viewerIsBezirksAdmin,
  viewerIsBezirksDrohnenAdmin,
}: {
  users: UserRow[];
  organizations: Organization[];
  dienstgrade: DienstgradOption[];
  droneGroups: { id: string; name: string }[];
  initialQuery: string;
  initialFeuerwehr: string;
  initialRolle: string;
  initialStatus: string;
  initialSort: string;
  initialDir: 'asc' | 'desc';
  currentUserId: string;
  initialEditUserId?: string;
  initialCreateOpen: boolean;
  adminNavItems: AdminNavItem[];
  reachableScopes: AdminScope[];
  isFullAdmin: boolean;
  viewerIsBezirksAdmin: boolean;
  viewerIsBezirksDrohnenAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setActionSlot } = useMobileHeader();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [sheetState, setSheetState] = useState<SheetState | null>(() => {
    if (initialCreateOpen) return { mode: 'create' };
    if (initialEditUserId && users.some((u) => u.id === initialEditUserId)) {
      return { mode: 'edit', userId: initialEditUserId };
    }
    return null;
  });

  const [queryInput, setQueryInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [feuerwehr, setFeuerwehr] = useState(initialFeuerwehr || 'ALLE');
  const [rolle, setRolle] = useState<SimpleFilter>((initialRolle as SimpleFilter) || 'ALLE');
  const [status, setStatus] = useState<StatusFilter>((initialStatus as StatusFilter) || 'ALLE');
  const [sortKey, setSortKey] = useState<SortKey>(
    SORT_OPTIONS.some((o) => o.key === initialSort) ? (initialSort as SortKey) : 'name',
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suchfeld 300ms debounced (Verwaltung-Brief.md 3.2), Rest der Filter/Sortierung wirkt sofort.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(queryInput), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryInput]);

  // Filter-/Sortierzustand in die URL gespiegelt, damit ein Link teilbar ist (Erstgebrauch von
  // URL-Sync in dieser Codebase) - reiner Lesezeichen-Mechanismus, kein Server-Refetch-Trigger:
  // das gefilterte/sortierte Array bleibt komplett clientseitig berechnet (siehe unten).
  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of ['ebene', 'bereich']) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    if (query) params.set('q', query);
    if (feuerwehr !== 'ALLE') params.set('feuerwehr', feuerwehr);
    if (rolle !== 'ALLE') params.set('rolle', rolle);
    if (status !== 'ALLE') params.set('status', status);
    if (sortKey !== 'name') params.set('sort', sortKey);
    if (sortDir !== 'asc') params.set('dir', sortDir);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, feuerwehr, rolle, status, sortKey, sortDir, searchParams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (feuerwehr !== 'ALLE' && u.homeOrganizationId !== feuerwehr) return false;
      if (rolle === 'JA' && !u.isAdmin) return false;
      if (rolle === 'NEIN' && u.isAdmin) return false;
      if (status !== 'ALLE' && getUserStatus(u) !== status) return false;
      if (!q) return true;
      return [u.name, u.email, u.stbNr, u.phone, u.homeOrg, u.adminFor, u.droneLabel].some((field) =>
        field.toLowerCase().includes(q),
      );
    });
  }, [users, query, feuerwehr, rolle, status]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = compareRows(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every((u) => selectedIds.has(u.id));
  const someVisibleSelected = sorted.some((u) => selectedIds.has(u.id));

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const u of sorted) {
        if (checked) next.add(u.id);
        else next.delete(u.id);
      }
      return next;
    });
  }

  const activeFilterCount = [feuerwehr !== 'ALLE', rolle !== 'ALLE', status !== 'ALLE'].filter(Boolean).length;

  // Verwaltung-Brief.md 5: Filter auf Mobile hinter einem Symbol in der Kopfzeile statt inline -
  // registriert über denselben MobileHeaderContext-Actionslot, den Kalender für sein Filter-Icon
  // nutzt (Mobile-Brief.md), da immer nur eine Seite gleichzeitig gemountet ist.
  useEffect(() => {
    setActionSlot(
      <button
        type="button"
        onClick={() => setMobileFiltersOpen(true)}
        aria-label="Filter"
        className="relative inline-flex h-8 w-8 items-center justify-center rounded p-1.5 hover:bg-white/10"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {activeFilterCount > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand" aria-hidden />
        )}
      </button>,
    );
    return () => setActionSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterCount]);

  function resetFilters() {
    setFeuerwehr('ALLE');
    setRolle('ALLE');
    setStatus('ALLE');
  }

  async function handleBulkSetActive(nextActive: boolean) {
    setBulkPending(true);
    const result = await bulkSetActive(Array.from(selectedIds), nextActive);
    setBulkPending(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.affectedCount} Benutzer ${nextActive ? 'aktiviert' : 'deaktiviert'}.`);
    setSelectedIds(new Set());
    router.refresh();
  }

  async function handleBulkChangeOrg(organizationId: string) {
    setBulkPending(true);
    const result = await bulkSetHomeOrganization(Array.from(selectedIds), organizationId);
    setBulkPending(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Feuerwehr für ${result.affectedCount} Benutzer geändert.`);
    setSelectedIds(new Set());
    router.refresh();
  }

  const homeOrgCount = useMemo(() => new Set(users.map((u) => u.homeOrganizationId)).size, [users]);

  function openEdit(id: string) {
    setSheetState({ mode: 'edit', userId: id });
  }

  // Select-Filter + Chips als gemeinsamer JSX-Ausdruck (nicht als eigene Komponente mit
  // Props) - läuft sowohl in der Desktop-Inline-Zeile als auch im mobilen Bottom Sheet
  // unverändert über denselben Closure-Zustand (feuerwehr/rolle/status/...), keine doppelte Logik.
  const filterControls = (
    <>
      <Select value={feuerwehr} onValueChange={setFeuerwehr}>
        <SelectTrigger className="w-full md:w-auto">
          <SelectValue placeholder="Feuerwehr" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALLE">Alle Feuerwehren</SelectItem>
          {Object.entries(groupByAbschnitt(organizations)).map(([abschnittName, orgs]) => (
            <SelectGroup key={abschnittName}>
              <SelectLabel>{abschnittName}</SelectLabel>
              {orgs.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

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

  const sheetTargetRow = sheetState?.mode === 'edit' ? users.find((u) => u.id === sheetState.userId) : undefined;
  const sheetTarget: UserSheetTarget | undefined = sheetTargetRow
    ? {
        id: sheetTargetRow.id,
        firstName: sheetTargetRow.firstName,
        lastName: sheetTargetRow.lastName,
        email: sheetTargetRow.email,
        stbNr: sheetTargetRow.stbNr,
        phone: sheetTargetRow.phone,
        isActive: sheetTargetRow.isActive,
        istAtemschutzgeraeteTraeger: sheetTargetRow.istAtemschutzgeraeteTraeger,
        homeOrganizationId: sheetTargetRow.homeOrganizationId,
        homeOrgName: sheetTargetRow.homeOrg,
        adminOrgIds: sheetTargetRow.adminOrgIds,
        droneRole: sheetTargetRow.droneRole,
        droneGroupId: sheetTargetRow.droneGroupId,
        lastLoginAt: sheetTargetRow.lastLoginAt,
        passwordChangedAt: sheetTargetRow.passwordChangedAt,
        dienstgradId: sheetTargetRow.dienstgradId,
        isBezirksAdmin: sheetTargetRow.isBezirksAdmin,
        isBezirksDrohnenAdmin: sheetTargetRow.isBezirksDrohnenAdmin,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-ink">Benutzer</h1>
          <p className="text-sm text-ink-faint">
            {users.length} Mitglieder in {homeOrgCount} Feuerwehren
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isFullAdmin && (
            <>
              <a
                href="/admin/benutzer/export"
                className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
              >
                Excel Export
              </a>
              <Link
                href="/admin/benutzer/import"
                className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
              >
                Excel Import
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setSheetState({ mode: 'create' })}
            className="hidden rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover md:inline-flex"
          >
            Neuer Benutzer
          </button>
        </div>
      </div>

      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={adminNavItems} />

      {/* Verwaltung-Brief.md 5: zwei Kennzahlkarten nebeneinander über der mobilen Kartenliste. */}
      <div className="flex gap-3 md:hidden">
        <StatCard label="Mitglieder gesamt" value={users.length} />
        <StatCard label="Davon inaktiv" value={users.filter((u) => !u.isActive).length} />
      </div>

      {/* Suchfeld bleibt auf Mobile inline sichtbar (primärer, meistgenutzter Filter) - nur die
          drei Select-Filter + Chips wandern hinter das Kopfzeilen-Symbol ins Bottom Sheet, analog
          zu "Inhalt zuerst, Einstellungen dahinter" aus Mobile-Brief.md/Kalender. */}
      <div className="relative w-full md:max-w-[320px]">
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" strokeLinecap="round" />
        </svg>
        <Input
          type="search"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Benutzer suchen…"
          className="pl-8"
        />
      </div>

      <div className="hidden flex-wrap items-center gap-2.5 md:flex">
        <Select value={feuerwehr} onValueChange={setFeuerwehr}>
          <SelectTrigger>
            <SelectValue placeholder="Feuerwehr" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALLE">Alle Feuerwehren</SelectItem>
            {Object.entries(groupByAbschnitt(organizations)).map(([abschnittName, orgs]) => (
              <SelectGroup key={abschnittName}>
                <SelectLabel>{abschnittName}</SelectLabel>
                {orgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        <Select value={rolle} onValueChange={(value) => setRolle(value as SimpleFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Rolle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALLE">Alle Rollen</SelectItem>
            <SelectItem value="JA">Admin</SelectItem>
            <SelectItem value="NEIN">Mitglied</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALLE">Alle Status</SelectItem>
            <SelectItem value="AKTIV">Aktiv</SelectItem>
            <SelectItem value="INAKTIV">Inaktiv</SelectItem>
            <SelectItem value="DEAKTIVIERT">Deaktiviert</SelectItem>
          </SelectContent>
        </Select>

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

      {someVisibleSelected && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-brand-subtle px-4 py-2.5 text-sm">
          <span className="font-medium text-ink">{selectedIds.size} ausgewählt</span>
          <button
            type="button"
            disabled={bulkPending}
            onClick={() => handleBulkSetActive(false)}
            className="font-medium text-brand-hover hover:underline disabled:opacity-50"
          >
            Deaktivieren
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={bulkPending}
              className="font-medium text-brand-hover hover:underline disabled:opacity-50"
            >
              Feuerwehr ändern
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {Object.entries(groupByAbschnitt(organizations)).map(([abschnittName, orgs]) => (
                <DropdownMenuGroup key={abschnittName}>
                  <DropdownMenuLabel>{abschnittName}</DropdownMenuLabel>
                  {orgs.map((org) => (
                    <DropdownMenuItem key={org.id} onSelect={() => handleBulkChangeOrg(org.id)}>
                      {org.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto font-medium text-ink-muted hover:underline"
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      {/* Sortier-Steuerung nur für die Kartenansicht - siehe COLUMNS-Kommentar in der Vorversion. */}
      <div className="flex gap-2 md:hidden">
        <select
          value={sortKey}
          onChange={(event) => toggleSort(event.target.value as SortKey)}
          aria-label="Sortieren nach"
          className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              Sortieren: {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
          aria-label="Sortierrichtung umkehren"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink"
        >
          {sortDir === 'asc' ? '▲ A–Z' : '▼ Z–A'}
        </button>
      </div>

      {users.length === 0 ? (
        // Verwaltung-Brief.md 3.4: "ganz leer" ist ein eigener Zustand, unterscheidet sich von
        // "leer nach Filterung" unten - primäre Aktion ist hier der Import, nicht "zurücksetzen".
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface p-8 text-center shadow-card">
          <p className="text-[15px] text-ink-muted">Noch keine Benutzer angelegt.</p>
          {isFullAdmin ? (
            <Link
              href="/admin/benutzer/import"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Excel Import
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setSheetState({ mode: 'create' })}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Neuer Benutzer
            </button>
          )}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg bg-surface p-6 text-center text-[15px] text-ink-muted shadow-card">
          Keine Benutzer entsprechen den Filtern.{' '}
          {(activeFilterCount > 0 || query) && (
            <button
              type="button"
              onClick={() => {
                resetFilters();
                setQueryInput('');
              }}
              className="font-medium text-brand hover:underline"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col rounded-lg bg-surface shadow-card md:hidden">
            {sorted.map((u) => (
              <UserCard key={u.id} user={u} onSelect={openEdit} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg bg-surface shadow-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                      aria-label="Alle auswählen"
                    />
                  </TableHead>
                  <TableHead className="w-20">
                    <button
                      type="button"
                      onClick={() => toggleSort('dienstgrad')}
                      className={`text-[11px] font-semibold uppercase tracking-[.08em] hover:text-ink ${
                        sortKey === 'dienstgrad' ? 'text-ink' : 'text-ink-muted'
                      }`}
                    >
                      Dienstgrad
                      {sortKey === 'dienstgrad' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </TableHead>
                  {(['name', 'homeOrg', 'adminFor', 'status'] as SortKey[]).map((key) => {
                    const option = SORT_OPTIONS.find((o) => o.key === key)!;
                    const active = key === sortKey;
                    return (
                      <TableHead key={key}>
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={`text-[11px] font-semibold uppercase tracking-[.08em] hover:text-ink ${active ? 'text-ink' : 'text-ink-muted'}`}
                        >
                          {option.label}
                          {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </TableHead>
                    );
                  })}
                  {(['email', 'droneLabel', 'pushCount', 'lastActive'] as SortKey[]).map((key) => {
                    const option = SORT_OPTIONS.find((o) => o.key === key)!;
                    const active = key === sortKey;
                    return (
                      <TableHead key={key} className="hidden xl:table-cell">
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={`text-[11px] font-semibold uppercase tracking-[.08em] hover:text-ink ${active ? 'text-ink' : 'text-ink-muted'}`}
                        >
                          {key === 'pushCount' ? 'Push' : option.label}
                          {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </TableHead>
                    );
                  })}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((u) => (
                  <TableRow
                    key={u.id}
                    onClick={() => openEdit(u.id)}
                    className="h-[52px] cursor-pointer border-line hover:bg-surface-sunken"
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(u.id)}
                        onCheckedChange={(checked) => toggleSelected(u.id, checked === true)}
                        aria-label={`${u.name} auswählen`}
                      />
                    </TableCell>
                    <TableCell className="text-ink-muted">{u.dienstgrad || '–'}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-ink">{u.name}</div>
                      <div className="text-xs text-ink-muted xl:hidden">{u.email}</div>
                    </TableCell>
                    <TableCell className="text-ink">{u.homeOrg}</TableCell>
                    <TableCell className="text-ink-faint">{u.adminFor}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE_CLASS[getUserStatus(u)]}>
                        {STATUS_LABEL[getUserStatus(u)]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-ink-muted xl:table-cell">{u.email}</TableCell>
                    <TableCell className="hidden text-ink-muted xl:table-cell">{u.droneLabel}</TableCell>
                    <TableCell
                      className="hidden xl:table-cell"
                      title={formatPushTooltip(u.pushDates)}
                    >
                      {u.pushCount > 0 ? (
                        <span className="font-medium text-success-text">{u.pushCount}</span>
                      ) : (
                        <span className="text-ink-faint">–</span>
                      )}
                    </TableCell>
                    {(() => {
                      const lastLoginDate = u.lastLoginAt ? new Date(u.lastLoginAt) : null;
                      const relative = formatRelativeDate(lastLoginDate, { fallback: '–' });
                      return (
                        <TableCell
                          className={`hidden xl:table-cell ${isOlderThanMonths(lastLoginDate, 12) ? 'text-ink-faint' : 'text-ink-muted'}`}
                          title={relative.title}
                        >
                          {relative.label}
                        </TableCell>
                      );
                    })()}
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <UserRowActions
                        userId={u.id}
                        isActive={u.isActive}
                        isSelf={u.id === currentUserId}
                        onEdit={() => openEdit(u.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <UserFormSheet
        open={sheetState !== null}
        onOpenChange={(open) => {
          if (!open) setSheetState(null);
        }}
        mode={sheetState?.mode ?? 'create'}
        organizations={organizations}
        dienstgrade={dienstgrade}
        droneGroups={droneGroups}
        viewerIsBezirksAdmin={viewerIsBezirksAdmin}
        viewerIsBezirksDrohnenAdmin={viewerIsBezirksDrohnenAdmin}
        target={sheetTarget}
        onSaved={() => {
          setSheetState(null);
          router.refresh();
        }}
      />

      {/* Verwaltung-Brief.md 5: Filter hinter einem Symbol in der Kopfzeile (siehe setActionSlot
          oben), Bottom Sheet statt Karten im Scrollfluss - derselbe filterControls-Ausdruck wie in
          der Desktop-Zeile, kein zweiter Satz Logik. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl md:hidden">
          <SheetHeader>
            <SheetTitle>Filter</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-6">{filterControls}</div>
        </SheetContent>
      </Sheet>

      {/* Verwaltung-Brief.md 5: primäre Aktion als fixierte Schaltfläche über der App-weiten
          MobileTabBar (z-30) - z-20 reicht, da beide sich nur vertikal berühren, nicht überlappen. */}
      <button
        type="button"
        onClick={() => setSheetState({ mode: 'create' })}
        className="fixed inset-x-5 z-20 flex h-[52px] items-center justify-center rounded-lg bg-brand text-sm font-medium text-white shadow-lg md:hidden"
        style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        Neuer Benutzer
      </button>
    </div>
  );
}
