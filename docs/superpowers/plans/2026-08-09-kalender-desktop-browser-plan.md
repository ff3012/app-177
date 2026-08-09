# Kalender Desktop-Browser-Ansicht Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Kalender module's desktop (`lg:`, 1024px+) list view to match the mobile design's
building blocks — month-grouped cards, a colored layer-strip per row, inline instant Zusage/Absage, and a
new "Nur anzeigen" RSVP-status filter — while leaving the tablet table and mobile card/bottom-sheet views
byte-for-byte unchanged.

**Architecture:** All new behavior is additive and scoped behind `lg:` Tailwind breakpoints or new,
`lg:`-only components. A new `KalenderDesktopSidebar` component replaces `KalenderFiltersContent` only in
the `lg:` sidebar slot (the mobile `BottomSheet` keeps using `KalenderFiltersContent` unchanged).
`EventListView` gains a third, `lg:`-only render branch (`DesktopMonthList`) alongside its existing mobile
card and tablet table branches, which are otherwise untouched except for a breakpoint boundary fix
(`sm:block` → `sm:block lg:hidden`, since the new `lg:` branch must take over from 1024px, not coexist with
the tablet table).

**Tech Stack:** Next.js Client Components (`'use client'`), React `useState`/`useMemo`, existing `setRsvp`
Server Action (unchanged), Tailwind CSS, `sonner` toasts.

## Global Constraints

- **Scope boundary**: every change in this plan applies only at `lg:` (1024px) and up, with exactly one
  documented exception (Task 1's `LAYER_LABELS` fix, which also affects the still-visible mobile/tablet
  `LayerLegend`). No task may touch `EventListRow`, `EventCard`, or `KalenderFiltersContent`'s existing
  behavior below `lg:`.
- **No schema/query changes**: every field the new UI needs (`myRsvpStatus`, `rsvpCounts`, `description`,
  `location`, `isVehicleBooking`) already exists on `CalendarEventInput` and is already populated by
  `src/app/(app)/kalender/page.tsx` — this plan does not touch `page.tsx` at all.
- **Reuse `setRsvp`** (`src/app/(app)/kalender/[eventId]/rsvp-actions.ts`) exactly as-is — same signature
  `setRsvp(eventId: string, status: ZusageStatus, note?: string): Promise<RsvpActionState>`, same
  optimistic-update/rollback/toast pattern already established by `src/components/home/home-todo-list.tsx`.
  Do not modify `rsvp-actions.ts`.
- **"Offen" definition**: an event starts within 14 days from now AND the current user has no
  `myRsvpStatus` for it yet, and it is not a vehicle-booking event (vehicle bookings have no RSVP concept
  at all, per the app's existing rule).
- Full spec: `docs/superpowers/specs/2026-08-09-kalender-desktop-browser-design.md`.

---

### Task 1: `LAYER_LABELS` reconciliation

**Files:**
- Modify: `src/lib/calendar/layer-colors.ts`

**Interfaces:** none — `LAYER_LABELS`'s type (`Record<string, string>`) and keys (`own`/`abschnitt`/
`drohnengruppe`) are unchanged, only the string values change. No other task depends on this one.

- [ ] **Step 1: Update the label strings**

Find:

```ts
export const LAYER_LABELS: Record<string, string> = {
  own: 'Allgemein · eigene Feuerwehr',
  abschnitt: 'Abschnittsweit',
  drohnengruppe: 'Drohnengruppe',
};
```

Replace with:

```ts
export const LAYER_LABELS: Record<string, string> = {
  own: 'Meine Feuerwehr',
  abschnitt: 'Abschnitt-Kalender',
  drohnengruppe: 'Drohnengruppe',
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (No other file needs to change — `LayerLegend` in
`src/components/calendar/layer-legend.tsx` already reads `LAYER_LABELS[key]` and will pick up the new
strings automatically; it renders below `lg:` in the Kalender module's mobile/tablet sidebar/bottom-sheet
today, which is the one documented exception to the `lg:`-only scope boundary.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/calendar/layer-colors.ts
git commit -m "Fix: Kalender-Legende-Labels an Ebenen-Toggle angeglichen (Meine Feuerwehr/Abschnitt-Kalender)"
```

---

### Task 2: Status-Filter, neue Desktop-Sidebar, Kopfzeile

**Files:**
- Create: `src/components/calendar/kalender-desktop-sidebar.tsx`
- Modify: `src/components/calendar/kalender-with-layers.tsx` (full-file replacement — the file is short and
  changes throughout, a full replacement is less error-prone than several overlapping edits)

**Interfaces:**
- Produces: `export type StatusFilter = 'ALLE' | 'OFFEN' | 'ZUGESAGT';` from `kalender-with-layers.tsx` —
  imported by `kalender-desktop-sidebar.tsx` in this task. No other task consumes it.
- Produces: `KalenderDesktopSidebar` component with props `{ layers: CalendarLayer[]; enabled:
  Record<string, boolean>; onToggle: (key: string, checked: boolean) => void; showDrone: boolean; icsLinks:
  IcsLink[]; statusFilter: StatusFilter; onStatusFilterChange: (filter: StatusFilter) => void; openCount:
  number }`.
- Consumes: nothing from Task 1 (independent).

- [ ] **Step 1: Create the new desktop sidebar component**

Create `src/components/calendar/kalender-desktop-sidebar.tsx`:

```tsx
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import type { CalendarLayer, IcsLink, StatusFilter } from './kalender-with-layers';

interface KalenderDesktopSidebarProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  icsLinks: IcsLink[];
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  openCount: number;
}

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: (openCount: number) => string }[] = [
  { value: 'ALLE', label: () => 'Alle' },
  { value: 'OFFEN', label: (openCount) => `Offen ${openCount}` },
  { value: 'ZUGESAGT', label: () => 'Zugesagt' },
];

/**
 * Desktop-Sidebar (Kalender Browser.dc.html, nur ab lg:) - bewusst eine EIGENE Komponente statt
 * einer Erweiterung von KalenderFiltersContent (die weiterhin unverändert für die mobile
 * BottomSheet zuständig bleibt): die Ebenen-Legende entfällt hier zugunsten einer Fußzeile in der
 * Ebenen-Karte, und die "Nur anzeigen"-Filterkarte mit eigener Rückmeldungen-Farblegende existiert
 * nur auf Desktop-Breite. Ein gemeinsames KalenderFiltersContent mit Bedingungen für all das wäre
 * am Ende nur eine Ansammlung von if/else-Zweigen für zwei tatsächlich unterschiedliche Layouts -
 * dieselbe bewusste Trennung wie AdminSidebarNav/AdminMobileTabs in der Verwaltung.
 */
export function KalenderDesktopSidebar({
  layers,
  enabled,
  onToggle,
  showDrone,
  icsLinks,
  statusFilter,
  onStatusFilterChange,
  openCount,
}: KalenderDesktopSidebarProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      {layers.length > 1 && (
        <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ebenen</span>
          {layers.map((layer) => (
            <ToggleSwitch
              key={layer.key}
              label={layer.label}
              checked={enabled[layer.key] ?? true}
              onChange={(checked) => onToggle(layer.key, checked)}
            />
          ))}
          {showDrone && (
            <p className="text-xs text-neutral-400">
              Termine der Kategorie Drohnengruppe sind nur für Mitglieder der Drohnengruppe sichtbar.
            </p>
          )}
          <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
            Die Farbe links am Termin zeigt die Ebene. Drohnengruppen-Termine sehen nur deren Mitglieder.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Nur anzeigen</span>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onStatusFilterChange(option.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                statusFilter === option.value
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {option.label(openCount)}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Rückmeldungen</span>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="h-3.5 w-6 shrink-0 rounded" style={{ backgroundColor: '#eaf6f0' }} />
            Zugesagt
          </span>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="h-3.5 w-6 shrink-0 rounded" style={{ backgroundColor: '#fdeeed' }} />
            Abgesagt
          </span>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="h-3.5 w-6 shrink-0 rounded" style={{ backgroundColor: '#f2f2f4' }} />
            Offen
          </span>
        </div>
      </div>

      <div className="rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">ICS Kalender Import</h2>
        <div className="flex flex-col gap-2 text-sm">
          {icsLinks.map((link) => (
            <div key={link.href} className="flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 text-brand"
                aria-hidden
              >
                <rect x="3" y="5" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
              </svg>
              <a href={link.href} className="text-brand hover:underline">
                {link.label}
              </a>
              <CopyLinkButton text={link.copyText} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `kalender-with-layers.tsx` in full**

Replace the entire contents of `src/components/calendar/kalender-with-layers.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarView, type CalendarEventInput } from './calendar-view';
import { EventListView } from './event-list-view';
import { KalenderFiltersContent } from './kalender-filters-content';
import { KalenderDesktopSidebar } from './kalender-desktop-sidebar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useMobileHeader } from '@/components/layout/mobile-header-context';

export interface CalendarLayer {
  key: string;
  label: string;
}

export interface IcsLink {
  label: string;
  href: string;
  copyText: string;
}

export type StatusFilter = 'ALLE' | 'OFFEN' | 'ZUGESAGT';

interface KalenderWithLayersProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
  icsLinks: IcsLink[];
}

type ViewMode = 'calendar' | 'list';

const OPEN_RSVP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** "Offen" für die neue Desktop-Sidebar/Kopfzeile (Kalender Browser.dc.html) - dieselbe 14-Tage-
 * Definition wie HomeTodoList's "Zu erledigen" (home-todo-list.tsx), hier aber eigenständig auf
 * CalendarEventInput berechnet statt eine geteilte Helper-Datei für zwei unterschiedliche
 * Datenformen (HomeEventCardData vs. CalendarEventInput) einzuführen. */
function isOpenForRsvp(event: CalendarEventInput): boolean {
  if (event.isVehicleBooking) return false;
  if (event.myRsvpStatus) return false;
  const startsInMs = new Date(event.start).getTime() - Date.now();
  return startsInMs <= OPEN_RSVP_WINDOW_MS;
}

function FilterIcon({ hasHiddenLayers }: { hasHiddenLayers: boolean }) {
  return (
    <span className="relative inline-flex">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {hasHiddenLayers && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand" aria-hidden />
      )}
    </span>
  );
}

// Ab lg: (1024px) - genau die Breite, an der der Seiten-Container (max-w-5xl) sein eigenes Maximum
// erreicht - wandert Ebenen/Legende/ICS in eine feste linke Sidebar, analog zum Mockup. Unterhalb
// lg: (Mobile-Brief.md V2-Mobile) verschwindet dieselbe Content-Komponente stattdessen komplett aus
// dem Seitenfluss und wandert hinter ein Filter-Icon in der Kopfleiste (via MobileHeaderContext) in
// ein Bottom Sheet - "Inhalt zuerst, Einstellungen dahinter" statt gestapelter Karten über dem Kalender.
//
// Kalender Browser.dc.html (Desktop-Browser-Ansicht): ab lg: bekommt die Sidebar eine eigene
// Komponente (KalenderDesktopSidebar) statt KalenderFiltersContent - die Legende entfällt dort
// zugunsten einer Fußzeile, eine neue "Nur anzeigen"-Statusfilter-Karte kommt dazu. Unterhalb lg:
// bleibt KalenderFiltersContent (BottomSheet) unverändert und bekommt nie einen statusFilter.
export function KalenderWithLayers({ events, layers, icsLinks }: KalenderWithLayersProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.key, true])),
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALLE');
  const [sheetOpen, setSheetOpen] = useState(false);
  const { setActionSlot } = useMobileHeader();

  const hasHiddenLayers = Object.values(enabled).some((value) => value === false);

  useEffect(() => {
    setActionSlot(
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Kalender-Ebenen filtern"
        className="rounded p-1.5 hover:bg-white/10"
      >
        <FilterIcon hasHiddenLayers={hasHiddenLayers} />
      </button>,
    );
    return () => setActionSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHiddenLayers]);

  // Vergangene Termine werden nur in der Listenansicht ausgeblendet (siehe Issue #1) - fest, ohne
  // Umschalter. Die Kalenderansicht (Gitter) zeigt weiterhin jeden Monat vollständig, da ein
  // Kalendergitter mit ausgeblendeten vergangenen Tagen/Terminen eher verwirrend als aufgeräumt wirkt.
  const filteredEvents = useMemo(
    () => events.filter((event) => enabled[event.layer ?? ''] !== false),
    [events, enabled],
  );

  const sortedEvents = useMemo(() => {
    const now = Date.now();
    const listEvents = filteredEvents.filter((event) => new Date(event.end).getTime() >= now);
    return [...listEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [filteredEvents]);

  const openCount = useMemo(() => sortedEvents.filter(isOpenForRsvp).length, [sortedEvents]);

  // Der Status-Filter (Kalender Browser.dc.html) wirkt bewusst nur auf die Listenansicht, nicht auf
  // das Kalendergitter - das Gitter hat keine vergleichbare Farbkennzeichnung für Rückmeldestatus,
  // ein stilles Verschwinden von Terminen dort wäre verwirrender als hilfreich.
  const visibleListEvents = useMemo(() => {
    if (statusFilter === 'OFFEN') return sortedEvents.filter(isOpenForRsvp);
    if (statusFilter === 'ZUGESAGT') return sortedEvents.filter((event) => event.myRsvpStatus === 'ZUGESAGT');
    return sortedEvents;
  }, [sortedEvents, statusFilter]);

  const showDrone = layers.some((layer) => layer.key === 'drohnengruppe');

  function handleToggle(key: string, checked: boolean) {
    setEnabled((prev) => ({ ...prev, [key]: checked }));
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="hidden lg:flex lg:w-64 lg:shrink-0">
        <KalenderDesktopSidebar
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          icsLinks={icsLinks}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          openCount={openCount}
        />
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Kalender-Ebenen">
        <KalenderFiltersContent
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          icsLinks={icsLinks}
        />
      </BottomSheet>

      <div className="flex flex-1 flex-col gap-4">
        <div className="hidden text-sm text-neutral-500 lg:block">
          {sortedEvents.length} Termine · {openCount} offene Rückmeldungen
        </div>
        <div className="flex sm:justify-end">
          <div className="flex w-full rounded-lg bg-neutral-100 p-1 shadow-sm sm:w-auto sm:bg-white">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium sm:flex-none ${
                viewMode === 'calendar'
                  ? 'bg-white text-neutral-900 shadow-sm sm:bg-brand sm:text-white sm:shadow-none'
                  : 'text-neutral-600 sm:hover:bg-neutral-100'
              }`}
            >
              Kalenderansicht
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium sm:flex-none ${
                viewMode === 'list'
                  ? 'bg-white text-neutral-900 shadow-sm sm:bg-brand sm:text-white sm:shadow-none'
                  : 'text-neutral-600 sm:hover:bg-neutral-100'
              }`}
            >
              Listenansicht
            </button>
          </div>
        </div>
        {viewMode === 'calendar' ? <CalendarView events={filteredEvents} /> : <EventListView events={visibleListEvents} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors. (`EventListView` still only accepts an `events` array — this task
does not yet touch that component, so the build's only new surface is the sidebar swap and the header line.)

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/kalender-desktop-sidebar.tsx src/components/calendar/kalender-with-layers.tsx
git commit -m "Feature: Desktop-Sidebar mit Status-Filter + Kopfzeilen-Zusammenfassung (Kalender Browser)"
```

---

### Task 3: Desktop-Monatsgruppen-Liste mit Inline-Rückmeldung

**Files:**
- Modify: `src/components/calendar/event-list-view.tsx` (full-file replacement)

**Interfaces:**
- Consumes: `CalendarEventInput` fields already present today (`myRsvpStatus`, `rsvpCounts`, `description`,
  `location`, `isVehicleBooking`, `layer`) — no changes to that type in this plan.
- Consumes: `setRsvp(eventId: string, status: ZusageStatus, note?: string): Promise<RsvpActionState>` from
  `src/app/(app)/kalender/[eventId]/rsvp-actions.ts`, unchanged.
- Produces: nothing new consumed by later tasks (Task 4 is verification only).

- [ ] **Step 1: Replace `event-list-view.tsx` in full**

Replace the entire contents of `src/components/calendar/event-list-view.tsx` with:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { CalendarEventInput } from './calendar-view';
import { AddToCalendarLink } from './add-to-calendar-link';
import { RsvpBadge } from './rsvp-badge';
import { VehicleBookingIcon } from './vehicle-booking-icon';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';
import { setRsvp } from '@/app/(app)/kalender/[eventId]/rsvp-actions';

const DOUBLE_CLICK_WINDOW_MS = 220;

function formatStartTime(event: CalendarEventInput): string {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start);
  return start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function formatTimeRange(event: CalendarEventInput): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startLabel = start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const endLabel = end.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${startLabel}–${endLabel}`;
}

/**
 * Ein Klick öffnet für JEDEN Benutzer (auch ohne Bearbeitungsrecht) die Detailansicht - ein
 * Doppelklick springt für editierbare Termine stattdessen direkt zum Bearbeiten-Formular. Da der
 * Browser bei einem Doppelklick trotzdem zuerst zwei einzelne click-Events feuert, wird der
 * Einzelklick-Sprung kurz verzögert und bei einem eintreffenden dblclick wieder verworfen -
 * sonst würde die Navigation aus dem ersten Klick bereits laufen, bevor der Doppelklick erkannt wird.
 * Geteilt zwischen der Tabellenzeile, der mobilen Karte und der neuen Desktop-Monatsgruppen-Zeile.
 */
function useRowClick(eventId: string, editable: boolean) {
  const router = useRouter();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      router.push(`/kalender/${eventId}`);
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleDoubleClick() {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    if (editable) router.push(`/kalender/${eventId}/bearbeiten`);
  }

  return { handleClick, handleDoubleClick };
}

function EventListRow({ event }: { event: CalendarEventInput }) {
  const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
  const start = new Date(event.start);

  return (
    <tr
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
      title={event.editable ? 'Klick für Details, Doppelklick zum Bearbeiten' : 'Klick für Details'}
    >
      <td className="whitespace-nowrap px-3 py-1">{start.toLocaleDateString('de-AT')}</td>
      <td className="whitespace-nowrap px-3 py-1">{formatStartTime(event)}</td>
      <td className="whitespace-nowrap px-3 py-1">{start.toLocaleDateString('de-AT', { weekday: 'long' })}</td>
      <td className="break-words px-3 py-1">
        {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
        {event.title}
      </td>
      <td className="break-words px-3 py-1">{event.organizationName ?? '–'}</td>
      <td className="px-3 py-1">
        <RsvpBadge counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
      </td>
      <td className="whitespace-nowrap px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="inline-flex items-center gap-1.5">
          <a
            href={`/kalender/${event.id}`}
            className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-100"
            title="Zusage & Teilnehmerliste"
          >
            Zusage
          </a>
          <AddToCalendarLink eventId={event.id} variant="icon" />
        </div>
      </td>
    </tr>
  );
}

/** Kartenansicht für schmale Bildschirme (Handy) - eine 7-spaltige Tabelle passt dort nicht lesbar
 * hin. Die Datums-Badge-Spalte + farbige Akzentleiste (Farbe aus layer-colors.ts, dieselbe Quelle
 * wie die Termin-Chips im Kalendergitter und die Legende) übernimmt die visuelle Zuordnung, die im
 * Gitter über die Chip-Farbe passiert - hier gibt es keine Chips, nur die Karte selbst. */
function EventCard({ event }: { event: CalendarEventInput }) {
  const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
  const start = new Date(event.start);
  const accentColor = LAYER_COLORS[event.layer ?? ''] ?? '#8e8e93';

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="flex cursor-pointer gap-3 border-b border-neutral-100 py-3 pl-0 pr-4 active:bg-neutral-50"
    >
      <div className="flex shrink-0 items-stretch gap-2 pl-4">
        <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
        <div className="flex w-9 flex-col items-center pt-0.5">
          <span className="text-lg font-bold leading-none text-neutral-900">{start.getDate()}</span>
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">
            {start.toLocaleDateString('de-AT', { weekday: 'short' })}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm text-neutral-600">{formatStartTime(event)}</span>
          <RsvpBadge counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
        </div>
        <span className="font-medium text-neutral-900">
          {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
          {event.title}
        </span>
        <div className="text-sm text-neutral-500">{event.organizationName ?? '–'}</div>
        <div className="mt-1 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <a href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
            Zusage & Details
          </a>
          <AddToCalendarLink eventId={event.id} variant="icon" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Desktop (lg:+) Monatsgruppen-Ansicht (Kalender Browser.dc.html) ---------------- */

const MONTH_LABELS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

interface MonthGroup {
  key: string;
  label: string;
  events: CalendarEventInput[];
}

/** events ist bereits chronologisch sortiert (kalender-with-layers.tsx) - hier nur noch nach
 * Jahr+Monat in aufeinanderfolgende Gruppen zusammengefasst, ohne erneut zu sortieren. */
function groupEventsByMonth(events: CalendarEventInput[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const event of events) {
    const start = new Date(event.start);
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({ key, label: `${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`, events: [event] });
    }
  }
  return groups;
}

function RsvpCountChips({ counts }: { counts: NonNullable<CalendarEventInput['rsvpCounts']> }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <span
        className="min-w-[34px] rounded px-2 py-1 text-center text-xs font-semibold"
        style={{ backgroundColor: '#eaf6f0', color: '#1b7a52' }}
      >
        {counts.ZUGESAGT}
      </span>
      <span
        className="min-w-[34px] rounded px-2 py-1 text-center text-xs font-semibold"
        style={{ backgroundColor: '#fdeeed', color: '#a33530' }}
      >
        {counts.ABGESAGT}
      </span>
      <span
        className="min-w-[34px] rounded px-2 py-1 text-center text-xs font-semibold"
        style={{ backgroundColor: '#f2f2f4', color: '#6c6c70' }}
      >
        {counts.UNKLAR}
      </span>
    </div>
  );
}

type RsvpStatus = 'ZUGESAGT' | 'ABGESAGT' | 'UNKLAR';

const RSVP_STATUS_LABEL: Record<RsvpStatus, string> = {
  ZUGESAGT: 'Zugesagt',
  ABGESAGT: 'Abgesagt',
  UNKLAR: 'Unklar',
};

const RSVP_STATUS_CLASS: Record<RsvpStatus, string> = {
  ZUGESAGT: 'bg-[#eaf6f0] text-[#1b7a52]',
  ABGESAGT: 'bg-[#fdeeed] text-[#a33530]',
  UNKLAR: 'bg-neutral-100 text-neutral-600',
};

interface DesktopEventRowProps {
  event: CalendarEventInput;
  overrideStatus?: 'ZUGESAGT' | 'ABGESAGT';
  pending: boolean;
  expanded: boolean;
  onRespond: (eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') => void;
  onToggleExpand: (eventId: string) => void;
}

/** Zeile der neuen Desktop-Monatsgruppen-Ansicht (Kalender Browser.dc.html, nur ab lg:) - eigene
 * Komponente statt Wiederverwendung von EventListRow, da Layout (Farbstreifen links, Datumsblock,
 * Inline-Zusage/Absage, Aufklapp-Panel) grundlegend anders ist als die Tabellenzeile. Bei
 * Fahrzeug-Reservierungen (kein Zusage-Konzept, siehe rsvp-actions.ts's eigene Sperre dafür) gibt
 * es weder RSVP-Chips noch Aufklapp-Chevron, nur einen "Buchung öffnen"-Button. */
function DesktopEventRow({ event, overrideStatus, pending, expanded, onRespond, onToggleExpand }: DesktopEventRowProps) {
  const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
  const start = new Date(event.start);
  const accentColor = LAYER_COLORS[event.layer ?? ''] ?? '#8e8e93';
  const status = overrideStatus ?? event.myRsvpStatus ?? null;

  return (
    <div className="border-b border-neutral-100 last:border-b-0" style={{ borderLeft: `5px solid ${accentColor}` }}>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className="flex cursor-pointer items-center gap-4 py-3 pl-4 pr-4 hover:bg-neutral-50"
        title={event.editable ? 'Klick für Details, Doppelklick zum Bearbeiten' : 'Klick für Details'}
      >
        <div className="w-14 shrink-0 text-center">
          <div className="text-2xl font-bold leading-none text-neutral-900">
            {String(start.getDate()).padStart(2, '0')}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {start.toLocaleDateString('de-AT', { weekday: 'short' })}
          </div>
        </div>

        <div className="min-w-[120px] flex-1">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-neutral-900">
            {event.isVehicleBooking && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Fahrzeug
              </span>
            )}
            {event.title}
          </div>
          <div className="text-sm text-neutral-500">
            {event.isVehicleBooking ? formatTimeRange(event) : formatStartTime(event)}
            {event.organizationName ? ` · ${event.organizationName}` : ''}
          </div>
        </div>

        {event.isVehicleBooking ? (
          <div className="flex shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
            <a
              href={`/kalender/${event.id}`}
              className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Buchung öffnen
            </a>
          </div>
        ) : (
          <>
            <RsvpCountChips counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
            <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {status ? (
                <span className={`rounded px-3 py-2 text-sm font-semibold ${RSVP_STATUS_CLASS[status]}`}>
                  {RSVP_STATUS_LABEL[status]}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onRespond(event.id, 'ZUGESAGT')}
                    className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Zusage
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onRespond(event.id, 'ABGESAGT')}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 disabled:opacity-60"
                  >
                    Absage
                  </button>
                </>
              )}
              <AddToCalendarLink eventId={event.id} variant="icon" />
              <button
                type="button"
                onClick={() => onToggleExpand(event.id)}
                aria-label={expanded ? 'Details einklappen' : 'Details aufklappen'}
                className="inline-flex shrink-0 rounded border border-neutral-300 bg-white px-2 py-2 text-neutral-500 hover:bg-neutral-100"
              >
                <span className={`inline-block transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
              </button>
            </div>
          </>
        )}
      </div>

      {expanded && (event.description || event.location) && (
        <div
          className="border-t border-neutral-100 bg-neutral-50 py-3 pl-[72px] pr-4 text-sm text-neutral-600"
          onClick={(e) => e.stopPropagation()}
        >
          {event.location && <div className="mb-1 font-medium text-neutral-700">{event.location}</div>}
          {event.description && <div className="whitespace-pre-wrap">{event.description}</div>}
        </div>
      )}
    </div>
  );
}

/** Hält den optimistischen Zusage/Absage-Zustand und das Aufklapp-Panel pro Zeile - exakt dasselbe
 * Muster wie HomeTodoList's responded/pending (siehe home-todo-list.tsx): sofortiges UI-Update,
 * Rollback + Toast bei einem Serverfehler, kein Seitenwechsel. */
function DesktopMonthList({ events }: { events: CalendarEventInput[] }) {
  const [overrideStatus, setOverrideStatus] = useState<Record<string, 'ZUGESAGT' | 'ABGESAGT'>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function handleRespond(eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') {
    setOverrideStatus((current) => ({ ...current, [eventId]: status }));
    setPending((current) => ({ ...current, [eventId]: true }));

    const result = await setRsvp(eventId, status);

    setPending((current) => ({ ...current, [eventId]: false }));
    if (result.error) {
      setOverrideStatus((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      toast.error(result.error);
    }
  }

  function handleToggleExpand(eventId: string) {
    setExpanded((current) => ({ ...current, [eventId]: !current[eventId] }));
  }

  const groups = groupEventsByMonth(events);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <div className="pl-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group.label}</div>
          <div className="overflow-hidden rounded-lg bg-white shadow-sm">
            {group.events.map((event) => (
              <DesktopEventRow
                key={event.id}
                event={event}
                overrideStatus={overrideStatus[event.id]}
                pending={Boolean(pending[event.id])}
                expanded={Boolean(expanded[event.id])}
                onRespond={handleRespond}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventListView({ events }: { events: CalendarEventInput[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
        Keine Termine vorhanden.
      </div>
    );
  }

  return (
    <>
      {/* Kartenansicht: unter sm (< 640px), z. B. Smartphones im Hochformat */}
      <div className="flex flex-col rounded-xl bg-white shadow-sm sm:hidden">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>

      {/* Tabellenansicht: sm bis unter lg (Tablet) - unverändert, jetzt auf diesen Bereich begrenzt */}
      <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm sm:block lg:hidden">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="w-[11%] px-3 py-1.5">Datum</th>
              <th className="w-[8%] px-3 py-1.5">Start</th>
              <th className="w-[10%] px-3 py-1.5">Tag</th>
              <th className="w-[27%] px-3 py-1.5">Betreff</th>
              <th className="w-[13%] px-3 py-1.5">Organisation</th>
              <th className="w-[16%] px-3 py-1.5">Zusagen</th>
              <th className="w-[15%] px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <EventListRow key={event.id} event={event} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Monatsgruppen-Ansicht: ab lg (Kalender Browser.dc.html) */}
      <div className="hidden lg:block">
        <DesktopMonthList events={events} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/event-list-view.tsx
git commit -m "Feature: Desktop-Monatsgruppen-Liste mit Inline-Zusage/Absage und Aufklapp-Zeile (Kalender Browser)"
```

---

### Task 4: Full Verification + CLAUDE.md + Commit

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — this task only verifies and documents Tasks 1-3.

- [ ] **Step 1: Full type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with zero errors.

- [ ] **Step 2: Browser-verify at `lg:` (1024px+) against real seeded data**

Using the Browser tool against `npm run dev`, logged in as a real member with at least one upcoming event
in their home organization's calendar and at least one Feuerwehr-admin-managed event with existing
`TerminZusage` rows (create test data via a temporary script if the seeded dev DB has none, restoring/
deleting it afterward):

1. Resize the viewport to 1280px wide (or the Browser tool's `desktop` preset) and open `/kalender`.
   Confirm: events render in month-labeled card groups ("August 2026" etc.), not a flat table; a colored
   strip on the left of each row matches that event's layer color; the header shows
   "`{n}` Termine · `{n}` offene Rückmeldungen" above the view toggle; the sidebar shows the "Ebenen" card
   (with the footnote sentence, no separate Legende card below it in this view), a "Nur anzeigen" card with
   three chips and a "Rückmeldungen" color-swatch legend, and the ICS card.
2. Click "Zusage" on an event with no existing RSVP. Confirm: no page navigation happens, the two buttons
   are immediately replaced by a single "Zugesagt" pill, and the header's/sidebar's "Offen" count decreases
   by one if that event was counted as open. Reload the page and confirm the change persisted (a real
   `TerminZusage` row was written).
3. Click the "⌄" button on a row that has a `description`/`location`. Confirm an inline panel appears
   below the row showing that text, without navigating; click again to collapse it.
4. Click the "Offen" and "Zugesagt" chips in the sidebar. Confirm the list re-filters accordingly and the
   "Alle" chip restores the full list.
5. If a vehicle-booking event exists in the visible range, confirm its row shows a "Fahrzeug" pill and a
   single "Buchung öffnen" button — no RSVP chips, no Zusage/Absage buttons, no expand chevron.
6. Resize to 768px (tablet) and to 390px (mobile). Confirm both look and behave exactly as they did before
   this plan — flat table at 768px, card list at 390px, same Ebenen/Legende/ICS content in the tablet
   sidebar and mobile bottom sheet (now showing "Meine Feuerwehr"/"Abschnitt-Kalender" labels per Task 1).

Clean up any temporary test data created for this verification.

- [ ] **Step 3: Update CLAUDE.md**

Add a new subsection under "### Kalender module" (after the existing "Kalender V3 (Mobile-Brief.md)"
subsection, following the same "Kalender V*" naming convention already used there) documenting: the new
`lg:`-only month-grouped list (`DesktopMonthList`/`DesktopEventRow` in `event-list-view.tsx`), the new
`KalenderDesktopSidebar` component and why it's separate from `KalenderFiltersContent`, the inline
optimistic Zusage/Absage reusing `setRsvp` (same pattern as `HomeTodoList`), the "Offen" 14-day definition
and that it's computed independently of `HomeTodoList`'s own version, and the `LAYER_LABELS` reconciliation
from Task 1. Cross-reference `docs/superpowers/specs/2026-08-09-kalender-desktop-browser-design.md` rather
than repeating its full rationale.

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "Docs: Kalender Desktop-Browser-Ansicht in CLAUDE.md dokumentiert"
```
