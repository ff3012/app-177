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
  SelectItem,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { UserFormSheet, type UserSheetTarget } from '@/components/admin/user-form-sheet';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { OrgSearchSelect } from '@/components/admin/org-search-select';
import type { AdminScope } from '@/lib/admin/scope';
import type { AdminNavItem } from '@/lib/admin/nav-items';
import { useMobileHeader } from '@/components/layout/mobile-header-context';
import type { DroneRoleOption } from '@/lib/validation/user.schema';
import { formatRelativeDate, isOlderThanMonths } from '@/lib/format';
import { getUserStatus, type UserStatus } from '@/lib/auth/user-status';
import { groupByAbschnitt } from '@/lib/admin/group-by-abschnitt';
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
  adminForShort: string;
  adminOrgIds: string[];
  droneLabel: string;
  droneRole: DroneRoleOption;
  droneGroupId: string | null;
  a1a3LizenzAm: string;
  a2LizenzAm: string;
  stuetzpunktausbildungAm: string;
  bos1AusbildungAm: string;
  bos2AusbildungAm: string;
  pushCount: number;
  pushDates: string[];
  isActive: boolean;
  istAtemschutzgeraeteTraeger: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  dienstgradId: string;
  dienstgrad: string;
  secondaryOrganizationId: string;
  secondaryDienstgradId: string;
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
}

type SheetState = { mode: 'create' } | { mode: 'edit'; userId: string };

interface Organization {
  id: string;
  name: string;
  abschnittName?: string;
  abschnittId?: string;
  isActive?: boolean;
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

/** Benutzerverwaltung-Breite-Brief.md §2: das Spaltenraster ist EINE Konstante, von Kopf- und
 * Datenzeilen geteilt statt pro Zeile wiederholt. Drei Stufen (Basis/xl=1280px/1600px) statt
 * Tailwinds Default-Skala, weil der Brief genau bei 1600px eine zusätzliche Stufe verlangt, die es
 * dort nicht gibt - min-[1600px]: ist Tailwinds Arbitrary-Variant-Syntax für einen Wert außerhalb
 * der konfigurierten Skala, ohne tailwind.config.ts anzufassen (dieser Breakpoint wird nirgends
 * sonst gebraucht). Spaltenreihenfolge folgt dem Mockup (Benutzerverwaltung Desktop.dc.html):
 * Checkbox/Dienstgrad/Name/Feuerwehr/Rolle/[E-Mail/Drohnen]/[Zuletzt aktiv/Push]/Status/Menü -
 * Status wandert damit hinter Push/Zuletzt-aktiv, anders als in der bisherigen <table>. */
const USERS_GRID_COLS =
  'grid-cols-[44px_78px_minmax(190px,1.15fr)_minmax(150px,.9fr)_minmax(210px,1.25fr)_90px_44px] ' +
  'xl:grid-cols-[44px_78px_minmax(190px,1.15fr)_minmax(150px,.9fr)_minmax(210px,1.25fr)_minmax(230px,1.4fr)_112px_90px_44px] ' +
  'min-[1600px]:grid-cols-[44px_78px_minmax(190px,1.15fr)_minmax(150px,.9fr)_minmax(210px,1.25fr)_minmax(230px,1.4fr)_112px_128px_76px_90px_44px]';
const USERS_GRID_ROW = `grid items-center gap-x-3.5 ${USERS_GRID_COLS} px-5`;

function SortHeaderButton({ label, sortKey, active, dir, onClick }: { label: string; sortKey: SortKey; active: boolean; dir: 'asc' | 'desc'; onClick: (key: SortKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`text-left text-[11px] font-semibold uppercase tracking-[.08em] hover:text-ink ${active ? 'text-ink' : 'text-ink-muted'}`}
    >
      {label}
      {active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );
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
  secondaryOrganizationOptions,
  dienstgrade,
  droneGroups,
  initialQuery,
  initialFeuerwehr,
  initialDrohnengruppe,
  initialRolle,
  initialStatus,
  initialSort,
  initialDir,
  currentUserId,
  initialEditUserId,
  initialCreateOpen,
  adminNavItems,
  reachableScopes,
  initialAbschnitt,
  abschnitte,
  isFullAdmin,
  viewerIsBezirksAdmin,
  viewerIsBezirksDrohnenAdmin,
  totalUsersCount,
  totalOrgsCount,
  filteredCount,
  page,
  pageSize,
}: {
  users: UserRow[];
  organizations: Organization[];
  /** Finding 1 (final-review, issue #21): erweiterte Organisationsliste nur für die
   * Zweite-Feuerwehr-Auswahl im UserFormSheet - enthält zusätzlich zu `organizations` jede
   * Organisation, die für einen scoped Admin außerhalb seines eigenen Verwaltungsbereichs liegt,
   * aber die zweite Feuerwehr eines Benutzers in seinem Bereich ist (siehe page.tsx). Bewusst NICHT
   * dieselbe Liste wie `organizations`, die auch "Admin für" und die Heimat-Feuerwehr-Auswahl speist
   * - dort darf ein scoped Admin weiterhin nur seinen eigenen Bereich sehen. */
  secondaryOrganizationOptions: Organization[];
  dienstgrade: DienstgradOption[];
  droneGroups: { id: string; name: string; isActive: boolean }[];
  initialQuery: string;
  initialFeuerwehr: string;
  initialDrohnengruppe: string;
  initialRolle: string;
  initialStatus: string;
  initialSort: string;
  initialDir: 'asc' | 'desc';
  currentUserId: string;
  initialEditUserId?: string;
  initialCreateOpen: boolean;
  adminNavItems: AdminNavItem[];
  reachableScopes: AdminScope[];
  initialAbschnitt: string;
  abschnitte: { id: string; name: string }[];
  isFullAdmin: boolean;
  viewerIsBezirksAdmin: boolean;
  viewerIsBezirksDrohnenAdmin: boolean;
  totalUsersCount: number;
  totalOrgsCount: number;
  filteredCount: number;
  page: number;
  pageSize: number;
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
  const [feuerwehr, setFeuerwehrState] = useState(initialFeuerwehr || 'ALLE');
  const [drohnengruppe, setDrohnengruppeState] = useState(initialDrohnengruppe || 'ALLE');
  const [abschnitt, setAbschnittState] = useState(initialAbschnitt || 'ALLE');
  const [rolle, setRolleState] = useState<SimpleFilter>((initialRolle as SimpleFilter) || 'ALLE');
  const [status, setStatusState] = useState<StatusFilter>((initialStatus as StatusFilter) || 'ALLE');
  const [sortKey, setSortKey] = useState<SortKey>(
    SORT_OPTIONS.some((o) => o.key === initialSort) ? (initialSort as SortKey) : 'name',
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir);
  const [pageState, setPageState] = useState(page);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Benutzerverwaltung-Breite-Brief.md §5: Filtern/Sortieren gilt für die GESAMTE (jetzt
  // serverseitige) Ergebnismenge, nicht nur die aktuell sichtbare Seite - jede Filter-/
  // Sortier-Änderung setzt die Seite deshalb auf 1 zurück. Nur die Zurück/Weiter-Buttons ändern
  // pageState ohne diese Funktion.
  function handleFilterChange() {
    setPageState(1);
  }

  function handleAbschnittChange(value: string) {
    setAbschnittState(value);
    setFeuerwehrState('ALLE');
    handleFilterChange();
  }
  function setFeuerwehr(value: string) {
    setFeuerwehrState(value);
    handleFilterChange();
  }
  function setDrohnengruppe(value: string) {
    setDrohnengruppeState(value);
    handleFilterChange();
  }
  function setRolle(value: SimpleFilter) {
    setRolleState(value);
    handleFilterChange();
  }
  function setStatus(value: StatusFilter) {
    setStatusState(value);
    handleFilterChange();
  }

  const feuerwehrOptions = useMemo(
    () => (abschnitt === 'ALLE' ? organizations : organizations.filter((org) => org.abschnittId === abschnitt)),
    [organizations, abschnitt],
  );
  const drohnengruppeOptions = useMemo(
    () => droneGroups.map((g) => ({ ...g, label: g.isActive ? g.name : `${g.name} (deaktiviert)` })),
    [droneGroups],
  );

  // Reagiert auf eine Änderung des GELTUNGSBEREICHS selbst (nicht auf eine Änderung dieses Filters) -
  // z. B. wenn der Geltungsbereich-Wähler eine andere Ebene wählt, während diese Seite bereits offen
  // ist. Ein useState-Initializer allein reicht dafür nicht, da er nur beim allerersten Mount läuft;
  // dieser Effekt erkennt die Änderung über einen Ref-Vergleich und überschreibt den (dann veralteten)
  // Filterzustand bewusst - eine erneute manuelle Filteränderung danach löst ihn nicht noch einmal aus,
  // da sich der Geltungsbereich selbst dabei nicht ändert.
  const previousScopeKeyRef = useRef(`${searchParams.get('ebene') ?? ''}:${searchParams.get('bereich') ?? ''}`);
  useEffect(() => {
    const currentScopeKey = `${searchParams.get('ebene') ?? ''}:${searchParams.get('bereich') ?? ''}`;
    if (currentScopeKey === previousScopeKeyRef.current) return;
    previousScopeKeyRef.current = currentScopeKey;
    if (!isFullAdmin) return;
    const bereich = searchParams.get('ebene') === 'abschnitt' ? searchParams.get('bereich') : null;
    const match = bereich ? abschnitte.find((a) => a.id === bereich) : undefined;
    setAbschnittState(match ? match.id : 'ALLE');
    setFeuerwehrState('ALLE');
    setPageState(1);
  }, [searchParams, isFullAdmin, abschnitte]);

  // Suchfeld 300ms debounced (Verwaltung-Brief.md 3.2), Rest der Filter/Sortierung wirkt sofort.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(queryInput);
      setPageState(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryInput]);

  // Filter-/Sortier-/Seitenzustand in die URL gespiegelt (Erstgebrauch von URL-Sync in dieser
  // Codebase) - seit §5 ist das kein reiner Lesezeichen-Mechanismus mehr, sondern der eigentliche
  // Auslöser für den serverseitigen Refetch: page.tsx liest genau diese Parameter und baut daraus
  // where/orderBy/skip/take. router.replace auf eine Route, deren Server Component searchParams
  // liest, lässt Next.js diese Component serverseitig neu ausführen.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of ['ebene', 'bereich']) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    if (query) params.set('q', query);
    if (abschnitt !== 'ALLE') {
      params.set('abschnitt', abschnitt);
    } else if (searchParams.get('ebene') === 'abschnitt') {
      // Explizites Löschen des Filters muss einen Reload überleben, auch wenn der
      // Geltungsbereich-Wähler weiterhin auf denselben Abschnitt zeigt (siehe CLAUDE.md,
      // Geltungsbereich-Wähler) - ein fehlender Parameter bedeutet sonst wieder "nie berührt" und
      // page.tsx würde den Wert aus dem Geltungsbereich erneut übernehmen.
      params.set('abschnitt', 'ALLE');
    }
    if (feuerwehr !== 'ALLE') params.set('feuerwehr', feuerwehr);
    if (drohnengruppe !== 'ALLE') params.set('drohnengruppe', drohnengruppe);
    if (rolle !== 'ALLE') params.set('rolle', rolle);
    if (status !== 'ALLE') params.set('status', status);
    if (sortKey !== 'name') params.set('sort', sortKey);
    if (sortDir !== 'asc') params.set('dir', sortDir);
    if (pageState !== 1) params.set('page', String(pageState));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, abschnitt, feuerwehr, drohnengruppe, rolle, status, sortKey, sortDir, pageState, searchParams]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    handleFilterChange();
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allVisibleSelected = users.length > 0 && users.every((u) => selectedIds.has(u.id));
  const someVisibleSelected = users.some((u) => selectedIds.has(u.id));

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const u of users) {
        if (checked) next.add(u.id);
        else next.delete(u.id);
      }
      return next;
    });
  }

  const activeFilterCount = [
    abschnitt !== 'ALLE',
    feuerwehr !== 'ALLE',
    drohnengruppe !== 'ALLE',
    rolle !== 'ALLE',
    status !== 'ALLE',
  ].filter(Boolean).length;

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
    setAbschnittState('ALLE');
    setFeuerwehrState('ALLE');
    setDrohnengruppeState('ALLE');
    setRolleState('ALLE');
    setStatusState('ALLE');
    handleFilterChange();
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

  function openEdit(id: string) {
    setSheetState({ mode: 'edit', userId: id });
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const rangeFrom = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, filteredCount);

  // Select-Filter + Chips als gemeinsamer JSX-Ausdruck (nicht als eigene Komponente mit
  // Props) - läuft sowohl in der Desktop-Inline-Zeile als auch im mobilen Bottom Sheet
  // unverändert über denselben Closure-Zustand (feuerwehr/rolle/status/...), keine doppelte Logik.
  // §4: Filterleiste in einer Zeile mit fixen Select-Breiten (176/176/176/148/136px) ab md: - auf
  // Mobile bleibt jedes Select w-full (siehe Sheet weiter unten), fixe Breiten gelten nur inline.
  const filterControls = (
    <>
      {isFullAdmin && (
        <OrgSearchSelect
          options={abschnitte}
          value={abschnitt}
          onChange={handleAbschnittChange}
          placeholder="Abschnitt"
          allLabel="Alle Abschnitte"
          triggerClassName="w-full md:w-[176px]"
        />
      )}

      <OrgSearchSelect
        options={feuerwehrOptions}
        value={feuerwehr}
        onChange={setFeuerwehr}
        placeholder="Feuerwehr"
        allLabel="Alle Feuerwehren"
        triggerClassName="w-full md:w-[176px]"
      />

      <Select value={drohnengruppe} onValueChange={setDrohnengruppe}>
        <SelectTrigger className="w-full md:w-[176px]">
          <SelectValue placeholder="Drohnengruppe" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALLE">Alle Drohnengruppen</SelectItem>
          {drohnengruppeOptions.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={rolle} onValueChange={(value) => setRolle(value as SimpleFilter)}>
        <SelectTrigger className="w-full md:w-[148px]">
          <SelectValue placeholder="Rolle" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALLE">Alle Rollen</SelectItem>
          <SelectItem value="JA">Admin</SelectItem>
          <SelectItem value="NEIN">Mitglied</SelectItem>
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
        <SelectTrigger className="w-full md:w-[136px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALLE">Alle Status</SelectItem>
          <SelectItem value="AKTIV">Aktiv</SelectItem>
          <SelectItem value="INAKTIV">Inaktiv</SelectItem>
          <SelectItem value="DEAKTIVIERT">Deaktiviert</SelectItem>
        </SelectContent>
      </Select>
    </>
  );

  const filterChips = (
    <div className="flex flex-wrap items-center gap-2">
      {abschnitt !== 'ALLE' && (
        <button
          type="button"
          onClick={() => handleAbschnittChange('ALLE')}
          className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[13px] text-ink-muted hover:bg-line"
        >
          {abschnitte.find((a) => a.id === abschnitt)?.name ?? 'Abschnitt'} <span className="text-ink-faint">×</span>
        </button>
      )}
      {feuerwehr !== 'ALLE' && (
        <button
          type="button"
          onClick={() => setFeuerwehr('ALLE')}
          className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[13px] text-ink-muted hover:bg-line"
        >
          {organizations.find((o) => o.id === feuerwehr)?.name ?? 'Feuerwehr'} <span className="text-ink-faint">×</span>
        </button>
      )}
      {drohnengruppe !== 'ALLE' && (
        <button
          type="button"
          onClick={() => setDrohnengruppe('ALLE')}
          className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[13px] text-ink-muted hover:bg-line"
        >
          {droneGroups.find((g) => g.id === drohnengruppe)?.name ?? 'Drohnengruppe'} <span className="text-ink-faint">×</span>
        </button>
      )}
      {rolle !== 'ALLE' && (
        <button
          type="button"
          onClick={() => setRolle('ALLE')}
          className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[13px] text-ink-muted hover:bg-line"
        >
          {rolle === 'JA' ? 'Admin' : 'Mitglied'} <span className="text-ink-faint">×</span>
        </button>
      )}
      {status !== 'ALLE' && (
        <button
          type="button"
          onClick={() => setStatus('ALLE')}
          className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[13px] text-ink-muted hover:bg-line"
        >
          Status: {STATUS_LABEL[status as UserStatus]} <span className="text-ink-faint">×</span>
        </button>
      )}
      {activeFilterCount > 0 && (
        <button type="button" onClick={resetFilters} className="text-[13px] font-semibold text-brand hover:underline">
          Alle zurücksetzen
        </button>
      )}
    </div>
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
        a1a3LizenzAm: sheetTargetRow.a1a3LizenzAm,
        a2LizenzAm: sheetTargetRow.a2LizenzAm,
        stuetzpunktausbildungAm: sheetTargetRow.stuetzpunktausbildungAm,
        bos1AusbildungAm: sheetTargetRow.bos1AusbildungAm,
        bos2AusbildungAm: sheetTargetRow.bos2AusbildungAm,
        lastLoginAt: sheetTargetRow.lastLoginAt,
        passwordChangedAt: sheetTargetRow.passwordChangedAt,
        dienstgradId: sheetTargetRow.dienstgradId,
        secondaryOrganizationId: sheetTargetRow.secondaryOrganizationId,
        secondaryDienstgradId: sheetTargetRow.secondaryDienstgradId,
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
            {totalUsersCount} Mitglieder in {totalOrgsCount} Feuerwehren · {users.length} angezeigt
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

      {/* Verwaltung-Brief.md 5: zwei Kennzahlkarten nebeneinander über der mobilen Kartenliste -
          seit §5 aus den serverseitigen Gesamtzahlen statt aus dem (jetzt nur noch seitenweise
          geladenen) users-Array, sonst würde "Mitglieder gesamt" auf Mobile plötzlich nur die
          aktuelle Seite zeigen. */}
      <div className="flex gap-3 md:hidden">
        <StatCard label="Mitglieder gesamt" value={totalUsersCount} />
        <StatCard label="Auf dieser Seite" value={users.length} />
      </div>

      {/* §4: eine Zeile ab md: - Suchfeld (flex 1 1 340px, max 400px) + fixe Selects, alles in
          einer weißen Karte über der Tabelle statt frei auf dem Grund. Auf Mobile bleibt das
          Suchfeld inline sichtbar (primärer Filter), die Selects wandern ins Bottom Sheet. */}
      <div className="flex flex-col gap-2.5 rounded-lg bg-surface p-3.5 shadow-card md:gap-3">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-2.5">
          <div className="relative w-full md:min-w-[220px] md:max-w-[400px] md:flex-[1_1_340px]">
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
          <div className="hidden flex-wrap items-center gap-2.5 md:flex">{filterControls}</div>
        </div>
        {activeFilterCount > 0 && <div className="hidden md:block">{filterChips}</div>}
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
              {Object.entries(groupByAbschnitt(organizations.filter((org) => org.isActive !== false))).map(([abschnittName, orgs]) => (
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

      {totalUsersCount === 0 ? (
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
      ) : filteredCount === 0 ? (
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
            {users.map((u) => (
              <UserCard key={u.id} user={u} onSelect={openEdit} />
            ))}
          </div>

          {/* §2/§3: CSS-Grid statt <table>+overflow-x-auto - Textspalten wachsen mit dem Fenster
              (minmax), Wertspalten bleiben fix. Spaltensichtbarkeit siehe USERS_GRID_COLS. */}
          <div className="hidden rounded-lg bg-surface shadow-card md:block">
            <div className={`${USERS_GRID_ROW} border-b-2 border-line-strong py-3`}>
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                aria-label="Alle auswählen"
              />
              <SortHeaderButton label="Grad" sortKey="dienstgrad" active={sortKey === 'dienstgrad'} dir={sortDir} onClick={toggleSort} />
              <SortHeaderButton label="Name" sortKey="name" active={sortKey === 'name'} dir={sortDir} onClick={toggleSort} />
              <SortHeaderButton label="Feuerwehr" sortKey="homeOrg" active={sortKey === 'homeOrg'} dir={sortDir} onClick={toggleSort} />
              <SortHeaderButton label="Rolle" sortKey="adminFor" active={sortKey === 'adminFor'} dir={sortDir} onClick={toggleSort} />
              <div className="hidden min-w-0 xl:block">
                <SortHeaderButton label="E-Mail" sortKey="email" active={sortKey === 'email'} dir={sortDir} onClick={toggleSort} />
              </div>
              <div className="hidden xl:block">
                <SortHeaderButton label="Drohnen" sortKey="droneLabel" active={sortKey === 'droneLabel'} dir={sortDir} onClick={toggleSort} />
              </div>
              <div className="hidden min-[1600px]:block">
                <SortHeaderButton label="Zuletzt aktiv" sortKey="lastActive" active={sortKey === 'lastActive'} dir={sortDir} onClick={toggleSort} />
              </div>
              <div className="hidden min-[1600px]:block">
                <SortHeaderButton label="Push" sortKey="pushCount" active={sortKey === 'pushCount'} dir={sortDir} onClick={toggleSort} />
              </div>
              <SortHeaderButton label="Status" sortKey="status" active={sortKey === 'status'} dir={sortDir} onClick={toggleSort} />
              <span />
            </div>

            {users.map((u) => {
              const status = getUserStatus(u);
              const lastLoginDate = u.lastLoginAt ? new Date(u.lastLoginAt) : null;
              const relative = formatRelativeDate(lastLoginDate, { fallback: '–' });
              return (
                <div
                  key={u.id}
                  onClick={() => openEdit(u.id)}
                  className={`${USERS_GRID_ROW} cursor-pointer border-b border-line py-[13px] last:border-0 hover:bg-surface-sunken`}
                >
                  <span onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(u.id)}
                      onCheckedChange={(checked) => toggleSelected(u.id, checked === true)}
                      aria-label={`${u.name} auswählen`}
                    />
                  </span>
                  <span className="text-ink-muted">{u.dienstgrad || '–'}</span>
                  <span className="min-w-0">
                    <div className="font-semibold text-ink">{u.name}</div>
                    <div className="truncate text-xs text-ink-muted xl:hidden">{u.email}</div>
                  </span>
                  <span className="min-w-0 truncate text-ink">{u.homeOrg}</span>
                  <span className="min-w-0 truncate text-ink-faint" title={u.adminFor}>
                    {u.adminForShort}
                  </span>
                  <span className="hidden min-w-0 truncate font-mono text-[14px] text-ink-muted xl:block" title={u.email}>
                    {u.email}
                  </span>
                  <span className="hidden xl:block">
                    {u.droneLabel !== '–' ? (
                      <span className="inline-flex rounded-[5px] bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-muted">
                        {u.droneLabel}
                      </span>
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </span>
                  <span
                    className={`hidden min-[1600px]:block ${isOlderThanMonths(lastLoginDate, 12) ? 'text-ink-faint' : 'text-ink-muted'}`}
                    title={relative.title}
                  >
                    {relative.label}
                  </span>
                  <span className="hidden min-[1600px]:block" title={formatPushTooltip(u.pushDates)}>
                    {u.pushCount > 0 ? (
                      <span className="font-medium text-success-text">{u.pushCount}</span>
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </span>
                  <span>
                    <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
                      {STATUS_LABEL[status]}
                    </Badge>
                  </span>
                  <span onClick={(event) => event.stopPropagation()} className="justify-self-end">
                    <UserRowActions
                      userId={u.id}
                      isActive={u.isActive}
                      isSelf={u.id === currentUserId}
                      onEdit={() => openEdit(u.id)}
                    />
                  </span>
                </div>
              );
            })}
          </div>

          {/* §5: Fußnote zur Drohnen-Spalte links, Paginierung rechts - Seitengröße fix 50
              (page.tsx). */}
          <div className="hidden items-center justify-between gap-5 px-1 md:flex">
            <span className="text-sm text-ink-faint">
              Die Spalte „Drohnen" zeigt die Gruppenzuordnung. Jedes Mitglied der Drohnengruppe gehört genau
              einer Gruppe an.
            </span>
            <div className="flex shrink-0 items-center gap-2.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPageState(page - 1)}
                className="rounded-md border border-line px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
              >
                Zurück
              </button>
              <span className="text-sm font-medium text-ink-muted">
                {rangeFrom}–{rangeTo} von {filteredCount}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPageState(page + 1)}
                className="rounded-md border border-line px-3.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-40"
              >
                Weiter
              </button>
            </div>
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
        secondaryOrganizationOptions={secondaryOrganizationOptions}
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
          <div className="flex flex-col gap-3 px-4 pb-6">
            {filterControls}
            {filterChips}
          </div>
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
