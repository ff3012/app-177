'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserFormSheet, type UserSheetTarget } from '@/components/admin/user-form-sheet';
import type { DroneRoleOption } from '@/lib/validation/user.schema';
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
  pushCount: number;
  pushDates: string[];
  isActive: boolean;
}

type SheetState = { mode: 'create' } | { mode: 'edit'; userId: string };

interface Organization {
  id: string;
  name: string;
}

type SortKey = 'name' | 'email' | 'stbNr' | 'phone' | 'homeOrg' | 'adminFor' | 'droneLabel' | 'pushCount' | 'status';
type SimpleFilter = 'ALLE' | 'JA' | 'NEIN';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'E-Mail' },
  { key: 'stbNr', label: 'StbNr' },
  { key: 'phone', label: 'Telefonnummer' },
  { key: 'homeOrg', label: 'Heimat-Feuerwehr' },
  { key: 'adminFor', label: 'Rolle' },
  { key: 'droneLabel', label: 'Drohnengruppe' },
  { key: 'pushCount', label: 'Push' },
  { key: 'status', label: 'Status' },
];

function compareRows(a: UserRow, b: UserRow, key: SortKey): number {
  switch (key) {
    case 'pushCount':
      return a.pushCount - b.pushCount;
    case 'status':
      return Number(a.isActive) - Number(b.isActive);
    default:
      return a[key].localeCompare(b[key], 'de');
  }
}

function formatPushTooltip(dates: string[]): string {
  if (dates.length === 0) return '';
  return dates.map((d) => `Registriert seit ${new Date(d).toLocaleDateString('de-AT')}`).join('\n');
}

/** Kartenansicht für schmale Bildschirme - Phase 6 (Mobile Verwaltung) verfeinert das noch
 * (Kennzahlkarten, Filter-Sheet, fixierte Aktion); hier vorerst nur an die neuen Feldnamen
 * angepasst, analog zu EventCard in components/calendar/event-list-view.tsx. */
function UserCard({ user, onSelect }: { user: UserRow; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(user.id)}
      className="block w-full border-b border-line px-4 py-3 text-left last:border-0"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">{user.name}</span>
        <Badge
          variant="outline"
          className={
            user.isActive ? 'border-transparent bg-success-subtle text-success-text' : 'border-transparent bg-danger-subtle text-danger'
          }
        >
          {user.isActive ? 'Aktiv' : 'Inaktiv'}
        </Badge>
      </div>
      <div className="break-words text-sm text-ink-muted">{user.homeOrg}</div>
      <div className="mt-1 text-sm text-ink-faint">{user.adminFor}</div>
    </button>
  );
}

export function UserManagementSection({
  users,
  organizations,
  initialQuery,
  initialFeuerwehr,
  initialRolle,
  initialStatus,
  initialSort,
  initialDir,
  currentUserId,
  initialEditUserId,
  initialCreateOpen,
}: {
  users: UserRow[];
  organizations: Organization[];
  initialQuery: string;
  initialFeuerwehr: string;
  initialRolle: string;
  initialStatus: string;
  initialSort: string;
  initialDir: 'asc' | 'desc';
  currentUserId: string;
  initialEditUserId?: string;
  initialCreateOpen: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

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
  const [status, setStatus] = useState<SimpleFilter>((initialStatus as SimpleFilter) || 'ALLE');
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
    if (query) params.set('q', query);
    if (feuerwehr !== 'ALLE') params.set('feuerwehr', feuerwehr);
    if (rolle !== 'ALLE') params.set('rolle', rolle);
    if (status !== 'ALLE') params.set('status', status);
    if (sortKey !== 'name') params.set('sort', sortKey);
    if (sortDir !== 'asc') params.set('dir', sortDir);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, feuerwehr, rolle, status, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (feuerwehr !== 'ALLE' && u.homeOrganizationId !== feuerwehr) return false;
      if (rolle === 'JA' && !u.isAdmin) return false;
      if (rolle === 'NEIN' && u.isAdmin) return false;
      if (status === 'JA' && !u.isActive) return false;
      if (status === 'NEIN' && u.isActive) return false;
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
        homeOrganizationId: sheetTargetRow.homeOrganizationId,
        adminOrgIds: sheetTargetRow.adminOrgIds,
        droneRole: sheetTargetRow.droneRole,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-ink">Benutzer</h1>
          <p className="text-sm text-ink-faint">
            {users.length} Mitglieder in {homeOrgCount} Feuerwehren
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
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
          <button
            type="button"
            onClick={() => setSheetState({ mode: 'create' })}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
          >
            Neuer Benutzer
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-[320px]">
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

        <Select value={feuerwehr} onValueChange={setFeuerwehr}>
          <SelectTrigger>
            <SelectValue placeholder="Feuerwehr" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALLE">Alle Feuerwehren</SelectItem>
            {organizations.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
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

        <Select value={status} onValueChange={(value) => setStatus(value as SimpleFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALLE">Alle Status</SelectItem>
            <SelectItem value="JA">Aktiv</SelectItem>
            <SelectItem value="NEIN">Inaktiv</SelectItem>
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
            {status === 'JA' ? 'Aktiv' : 'Inaktiv'} ✕
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
              {organizations.map((org) => (
                <DropdownMenuItem key={org.id} onSelect={() => handleBulkChangeOrg(org.id)}>
                  {org.name}
                </DropdownMenuItem>
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
      <div className="flex gap-2 sm:hidden">
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

      {sorted.length === 0 ? (
        <div className="rounded-lg bg-surface p-6 text-center text-sm text-ink-muted shadow-card">
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
          <div className="flex flex-col rounded-lg bg-surface shadow-card sm:hidden">
            {sorted.map((u) => (
              <UserCard key={u.id} user={u} onSelect={openEdit} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg bg-surface shadow-card sm:block">
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
                  {(['email', 'droneLabel', 'pushCount'] as SortKey[]).map((key) => {
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
                    <TableCell>
                      <div className="font-semibold text-ink">{u.name}</div>
                      <div className="text-xs text-ink-muted xl:hidden">{u.email}</div>
                    </TableCell>
                    <TableCell className="text-ink">{u.homeOrg}</TableCell>
                    <TableCell className="text-ink-faint">{u.adminFor}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          u.isActive
                            ? 'border-transparent bg-success-subtle text-success-text'
                            : 'border-transparent bg-danger-subtle text-danger'
                        }
                      >
                        {u.isActive ? 'Aktiv' : 'Inaktiv'}
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
        target={sheetTarget}
        onSaved={() => {
          setSheetState(null);
          router.refresh();
        }}
      />
    </div>
  );
}
