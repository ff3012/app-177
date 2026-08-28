# Android Offline-Kalender (Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Kalender view readable offline in the native Android app by reusing the existing
calendar display components in a new, separate Vite bundle that reads a locally-cached JSON
snapshot, replacing the current bare "no connection" fallback.

**Architecture:** `CalendarView`/`EventListView`/`KalenderWithLayers` become router-agnostic and gain
a `readOnly` mode (fully additive — existing online behavior is unchanged when omitted). A new
Android-only effect writes a time-bounded JSON snapshot of the already-loaded calendar data to disk
via `@capacitor/filesystem` on every normal online visit. A new, separate Vite-built bundle
(`native-offline/`) imports these same components and renders them from that snapshot when
`capacitor.config.ts`'s `server.errorPath` kicks in (WebView failed to reach the live server).

**Tech Stack:** Next.js App Router (existing), React 19, `@capacitor/filesystem` (new dependency),
Vite + `@vitejs/plugin-react` (new devDependencies), Tailwind v3 (reused config), existing
`CalendarEventInput` type.

## Global Constraints

- Read-only only: no offline RSVP, event create/edit, or `.ics` download — those require the server
  and stay online-only.
- Android-native only: no changes to iOS or the PWA/service-worker path.
- Every change to `CalendarView`/`EventListView`/`KalenderWithLayers` must be additive — when
  `readOnly` is omitted/`false` and `onNavigate` behaves like today's `router.push`, the rendered
  online output must be unchanged.
- Cache filter uses the event's `end` field, not `start` (`end >= heute - 30 Tage`), so a multi-day
  event that started before the window but ends within/after it is not dropped.
- No new automated tests — this repo has none; verification is `npx tsc --noEmit`, `npm run build`,
  `npm run build:offline` (new), and manual on-device testing (flight mode) per Task 4.
- Reuse the existing `CalendarEventInput` type and existing Tailwind tokens/`globals.css` — no new
  color or type definitions.

---

### Task 1: Make `CalendarView`, `EventListView`, `KalenderWithLayers` router-agnostic and add `readOnly` mode

**Files:**
- Modify: `src/components/calendar/calendar-view.tsx`
- Modify: `src/components/calendar/event-list-view.tsx`
- Modify: `src/components/calendar/kalender-with-layers.tsx`
- Create: `src/components/calendar/kalender-with-layers-online.tsx`
- Modify: `src/app/(app)/kalender/page.tsx`

**Interfaces:**
- Produces: `CalendarView({ events, readOnly?: boolean, onNavigate?: (path: string) => void })` — no
  longer imports `next/navigation`.
- Produces: `EventListView({ events, desktopEvents?, readOnly?: boolean, onNavigate?: (path: string) => void })`
  — no longer imports `next/navigation`/`next/link`.
- Produces: `KalenderWithLayers({ events, layers, readOnly?: boolean, onNavigate?: (path: string) => void })`
  — same public shape as today plus the two new optional props, both defaulting to today's online
  behavior when supplied via `KalenderWithLayersOnline`.
- Produces: `KalenderWithLayersOnline({ events, layers })` — the new default export site for the real
  Next.js page; supplies `onNavigate` via `useRouter().push`.
- Consumes (Task 2): none yet — Task 2 adds `OfflineCacheSync` into `KalenderWithLayersOnline`.

- [ ] **Step 1: `calendar-view.tsx` — remove `useRouter`, add `readOnly`/`onNavigate`**

Replace the import line and the component signature/body exactly as follows.

```diff
- import { useRouter } from 'next/navigation';
  import { AddToCalendarLink } from './add-to-calendar-link';
```

```diff
- export function CalendarView({ events }: { events: CalendarEventInput[] }) {
-   const router = useRouter();
+ export function CalendarView({
+   events,
+   readOnly = false,
+   onNavigate,
+ }: {
+   events: CalendarEventInput[];
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
+ }) {
    const [viewEvent, setViewEvent] = useState<CalendarEventInput | null>(null);

    function handleEventClick(info: EventClickArg) {
-     if (info.event.extendedProps.editable) {
-       router.push(`/kalender/${info.event.id}/bearbeiten`);
+     if (!readOnly && info.event.extendedProps.editable && onNavigate) {
+       onNavigate(`/kalender/${info.event.id}/bearbeiten`);
        return;
      }
      const event = events.find((e) => e.id === info.event.id);
      if (event) setViewEvent(event);
    }
```

Then wrap the modal's bottom link row so it's hidden in `readOnly` mode:

```diff
-           <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
-             <AddToCalendarLink eventId={viewEvent.id} />
-             <a href={`/kalender/${viewEvent.id}`} className="text-sm font-medium text-brand hover:underline">
-               Zusage & Teilnehmerliste
-             </a>
-           </div>
+           {!readOnly && (
+             <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
+               <AddToCalendarLink eventId={viewEvent.id} />
+               <a href={`/kalender/${viewEvent.id}`} className="text-sm font-medium text-brand hover:underline">
+                 Zusage & Teilnehmerliste
+               </a>
+             </div>
+           )}
```

Nothing else in this file changes — `renderEventContent`, the FullCalendar setup, and the modal's
`<dl>` info block stay exactly as-is (already pure display, no server/router dependency).

- [ ] **Step 2: `event-list-view.tsx` — remove `useRouter`/`next/link`, thread `readOnly`/`onNavigate`**

Replace the top imports:

```diff
  'use client';

  import { useRef, useState } from 'react';
- import { useRouter } from 'next/navigation';
- import Link from 'next/link';
  import { toast } from 'sonner';
```

Replace `useRowClick` so it never calls a router itself:

```diff
- function useRowClick(eventId: string, editable: boolean) {
-   const router = useRouter();
+ function useRowClick(eventId: string, editable: boolean, onNavigate?: (path: string) => void) {
    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleClick() {
+     if (!onNavigate) return;
      if (clickTimer.current) return;
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
-       router.push(`/kalender/${eventId}`);
+       onNavigate(`/kalender/${eventId}`);
      }, DOUBLE_CLICK_WINDOW_MS);
    }

    function handleDoubleClick() {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
-     if (editable) router.push(`/kalender/${eventId}/bearbeiten`);
+     if (editable && onNavigate) onNavigate(`/kalender/${eventId}/bearbeiten`);
    }

    return { handleClick, handleDoubleClick };
  }
```

`EventListRow` — accept and pass through the two new props, hide the trailing action cell when
`readOnly`:

```diff
- function EventListRow({ event }: { event: CalendarEventInput }) {
-   const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
+ function EventListRow({
+   event,
+   readOnly,
+   onNavigate,
+ }: {
+   event: CalendarEventInput;
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
+ }) {
+   const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable, onNavigate);
```

```diff
-       <td className="whitespace-nowrap px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
-         <div className="inline-flex items-center gap-1.5">
-           {event.isVehicleBooking ? (
-             <a
-               href={`/kalender/${event.id}`}
-               className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-100"
-             >
-               Buchung öffnen
-             </a>
-           ) : (
-             <>
-               <a
-                 href={`/kalender/${event.id}`}
-                 className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-100"
-                 title="Zusage & Teilnehmerliste"
-               >
-                 Zusage
-               </a>
-               <AddToCalendarLink eventId={event.id} variant="icon" />
-             </>
-           )}
-         </div>
-       </td>
+       <td className="whitespace-nowrap px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
+         {!readOnly && (
+           <div className="inline-flex items-center gap-1.5">
+             {event.isVehicleBooking ? (
+               <a
+                 href={`/kalender/${event.id}`}
+                 className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-100"
+               >
+                 Buchung öffnen
+               </a>
+             ) : (
+               <>
+                 <a
+                   href={`/kalender/${event.id}`}
+                   className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-100"
+                   title="Zusage & Teilnehmerliste"
+                 >
+                   Zusage
+                 </a>
+                 <AddToCalendarLink eventId={event.id} variant="icon" />
+               </>
+             )}
+           </div>
+         )}
+       </td>
```

`EventCard` — same pattern:

```diff
- function EventCard({ event }: { event: CalendarEventInput }) {
-   const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
+ function EventCard({
+   event,
+   readOnly,
+   onNavigate,
+ }: {
+   event: CalendarEventInput;
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
+ }) {
+   const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable, onNavigate);
```

```diff
-         <div className="mt-1 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
-           {event.isVehicleBooking ? (
-             <a href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
-               Buchung öffnen
-             </a>
-           ) : (
-             <>
-               <a href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
-                 Zusage & Details
-               </a>
-               <AddToCalendarLink eventId={event.id} variant="icon" />
-             </>
-           )}
-         </div>
+         {!readOnly && (
+           <div className="mt-1 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
+             {event.isVehicleBooking ? (
+               <a href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
+                 Buchung öffnen
+               </a>
+             ) : (
+               <>
+                 <a href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
+                   Zusage & Details
+                 </a>
+                 <AddToCalendarLink eventId={event.id} variant="icon" />
+               </>
+             )}
+           </div>
+         )}
```

`DesktopEventRowProps`/`DesktopEventRow` — add the two props, replace the `Link` title with a plain
`span`, hide the vehicle-booking link and the interactive Zusage/Absage buttons + `AddToCalendarLink`
when `readOnly` (the expand/collapse chevron and `RsvpCountChips`/status badge stay — they're already
pure local state / read-only display):

```diff
  interface DesktopEventRowProps {
    event: CalendarEventInput;
    overrideStatus?: 'ZUGESAGT' | 'ABGESAGT';
    pending: boolean;
    expanded: boolean;
    onRespond: (eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') => void;
    onToggleExpand: (eventId: string) => void;
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
  }

- function DesktopEventRow({ event, overrideStatus, pending, expanded, onRespond, onToggleExpand }: DesktopEventRowProps) {
-   const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
+ function DesktopEventRow({
+   event,
+   overrideStatus,
+   pending,
+   expanded,
+   onRespond,
+   onToggleExpand,
+   readOnly,
+   onNavigate,
+ }: DesktopEventRowProps) {
+   const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable, onNavigate);
```

```diff
-           <Link href={`/kalender/${event.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
-             {event.title}
-           </Link>
+           <span className="hover:underline">{event.title}</span>
```

```diff
        {event.isVehicleBooking ? (
-         <div
-           className="flex shrink-0 justify-end"
-           onClick={(e) => e.stopPropagation()}
-           onDoubleClick={(e) => e.stopPropagation()}
-         >
-           <a
-             href={`/kalender/${event.id}`}
-             className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
-           >
-             Buchung öffnen
-           </a>
-         </div>
+         !readOnly && (
+           <div
+             className="flex shrink-0 justify-end"
+             onClick={(e) => e.stopPropagation()}
+             onDoubleClick={(e) => e.stopPropagation()}
+           >
+             <a
+               href={`/kalender/${event.id}`}
+               className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
+             >
+               Buchung öffnen
+             </a>
+           </div>
+         )
        ) : (
          <>
            <RsvpCountChips counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
            <div
              className="flex shrink-0 items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {status ? (
                <span className={`rounded px-3 py-2 text-sm font-semibold ${RSVP_STATUS_CLASS[status]}`}>
                  {RSVP_STATUS_LABEL[status]}
                </span>
-             ) : (
+             ) : !readOnly ? (
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
-             )}
-             <AddToCalendarLink eventId={event.id} variant="icon" />
+             ) : null}
+             {!readOnly && <AddToCalendarLink eventId={event.id} variant="icon" />}
              <button
```

`DesktopMonthList` — accept and forward the two props:

```diff
- function DesktopMonthList({ events }: { events: CalendarEventInput[] }) {
+ function DesktopMonthList({
+   events,
+   readOnly,
+   onNavigate,
+ }: {
+   events: CalendarEventInput[];
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
+ }) {
```

```diff
              <DesktopEventRow
                key={event.id}
                event={event}
                overrideStatus={overrideStatus[event.id]}
                pending={Boolean(pending[event.id])}
                expanded={Boolean(expanded[event.id])}
                onRespond={handleRespond}
                onToggleExpand={handleToggleExpand}
+               readOnly={readOnly}
+               onNavigate={onNavigate}
              />
```

Finally, `EventListView`'s own signature and its three render branches:

```diff
  export function EventListView({
    events,
    desktopEvents,
+   readOnly,
+   onNavigate,
  }: {
    events: CalendarEventInput[];
    desktopEvents?: CalendarEventInput[];
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
  }) {
    const eventsForDesktop = desktopEvents ?? events;
```

```diff
        <div className="flex flex-col rounded-xl bg-white shadow-sm sm:hidden">
          {events.map((event) => (
-           <EventCard key={event.id} event={event} />
+           <EventCard key={event.id} event={event} readOnly={readOnly} onNavigate={onNavigate} />
          ))}
        </div>
```

```diff
            <tbody>
              {events.map((event) => (
-               <EventListRow key={event.id} event={event} />
+               <EventListRow key={event.id} event={event} readOnly={readOnly} onNavigate={onNavigate} />
              ))}
            </tbody>
```

```diff
          ) : (
-           <DesktopMonthList events={eventsForDesktop} />
+           <DesktopMonthList events={eventsForDesktop} readOnly={readOnly} onNavigate={onNavigate} />
        )}
```

- [ ] **Step 3: `kalender-with-layers.tsx` — accept and forward `readOnly`/`onNavigate`**

```diff
  interface KalenderWithLayersProps {
    events: CalendarEventInput[];
    layers: CalendarLayer[];
+   readOnly?: boolean;
+   onNavigate?: (path: string) => void;
  }
```

```diff
- export function KalenderWithLayers({ events, layers }: KalenderWithLayersProps) {
+ export function KalenderWithLayers({ events, layers, readOnly = false, onNavigate }: KalenderWithLayersProps) {
```

```diff
        {viewMode === 'calendar' ? (
-         <CalendarView events={filteredEvents} />
+         <CalendarView events={filteredEvents} readOnly={readOnly} onNavigate={onNavigate} />
        ) : (
-         <EventListView events={sortedEvents} desktopEvents={visibleListEvents} />
+         <EventListView
+           events={sortedEvents}
+           desktopEvents={visibleListEvents}
+           readOnly={readOnly}
+           onNavigate={onNavigate}
+         />
        )}
```

Nothing else in this file changes — `useMobileHeader()` already returns a safe no-op when no
`MobileHeaderProvider` is present (confirmed in `src/components/layout/mobile-header-context.tsx`),
so this component needs no guard for running outside the main app's layout.

- [ ] **Step 4: Create the Next.js-specific adapter `kalender-with-layers-online.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { KalenderWithLayers, type CalendarLayer } from './kalender-with-layers';
import type { CalendarEventInput } from './calendar-view';

interface KalenderWithLayersOnlineProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

/**
 * Next.js-spezifischer Adapter für KalenderWithLayers: liefert die echte router.push-Navigation.
 * KalenderWithLayers selbst bleibt dadurch frei von next/navigation und ist so auch im
 * eigenständigen Offline-Bundle (native-offline/) wiederverwendbar - siehe
 * docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
 */
export function KalenderWithLayersOnline({ events, layers }: KalenderWithLayersOnlineProps) {
  const router = useRouter();
  return <KalenderWithLayers events={events} layers={layers} onNavigate={(path) => router.push(path)} />;
}
```

- [ ] **Step 5: Wire `kalender/page.tsx` to the new adapter**

```diff
- import { KalenderWithLayers, type CalendarLayer } from '@/components/calendar/kalender-with-layers';
+ import { KalenderWithLayersOnline } from '@/components/calendar/kalender-with-layers-online';
+ import type { CalendarLayer } from '@/components/calendar/kalender-with-layers';
```

```diff
-       <KalenderWithLayers events={calendarEvents} layers={layers} />
+       <KalenderWithLayersOnline events={calendarEvents} layers={layers} />
```

- [ ] **Step 6: Verify no regression**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors. Then start the dev server (`npm run dev`), open `/kalender`
in a browser, and confirm: grid/list toggle works, clicking a non-editable grid event still opens
the local detail modal, clicking an editable grid event still navigates to the edit page, clicking a
list row still navigates to the detail page (single click) or edit page (double click, if editable),
the "Zusage"/"Zusage & Details"/"Buchung öffnen" links and the `.ics` icon still render exactly as
before. This confirms `readOnly`/`onNavigate` are fully additive.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/calendar-view.tsx src/components/calendar/event-list-view.tsx src/components/calendar/kalender-with-layers.tsx src/components/calendar/kalender-with-layers-online.tsx "src/app/(app)/kalender/page.tsx"
git commit -m "refactor: make calendar display components router-agnostic with readOnly mode"
```

---

### Task 2: Android-only background cache writer

**Files:**
- Create: `src/components/calendar/offline-cache-sync.tsx`
- Modify: `src/components/calendar/kalender-with-layers-online.tsx`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `CalendarEventInput` (`calendar-view.tsx`), `CalendarLayer` (`kalender-with-layers.tsx`).
- Produces: `OfflineKalenderCache` type (`{ syncedAt: string; events: CalendarEventInput[]; layers: CalendarLayer[] }`)
  and the on-disk path `offline-cache/kalender.json` under `Directory.Data` — Task 4's offline bundle
  reads this exact shape from this exact path.

- [ ] **Step 1: Add the `@capacitor/filesystem` dependency**

```bash
npm install @capacitor/filesystem@^8
```

Expected: `package.json`'s `dependencies` gains `"@capacitor/filesystem": "^8.x.x"` and
`package-lock.json` updates. This is the first Capacitor storage plugin in this repo.

- [ ] **Step 2: Create `offline-cache-sync.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { CalendarEventInput } from './calendar-view';
import type { CalendarLayer } from './kalender-with-layers';

const CACHE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_DIR_PATH = 'offline-cache';
const CACHE_FILE_PATH = `${CACHE_DIR_PATH}/kalender.json`;

export interface OfflineKalenderCache {
  syncedAt: string;
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

interface OfflineCacheSyncProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

/**
 * Android-only, best-effort: schreibt bei jedem normalen Online-Besuch der Kalender-Seite einen
 * lokalen JSON-Snapshot (letzte 30 Tage + alle zukünftigen Termine, gefiltert nach `end`, nicht
 * `start` - ein mehrtägiger Termin, der vor 40 Tagen begann und erst morgen endet, bleibt so im
 * Cache), den die Offline-Ansicht (native-offline/) später liest. Ein Fehler hier darf die normale
 * Online-Anzeige nie beeinträchtigen - siehe
 * docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
 */
export function OfflineCacheSync({ events, layers }: OfflineCacheSyncProps) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    async function writeCache() {
      try {
        const cutoff = Date.now() - CACHE_WINDOW_MS;
        const cachedEvents = events.filter((event) => new Date(event.end).getTime() >= cutoff);
        const cache: OfflineKalenderCache = {
          syncedAt: new Date().toISOString(),
          events: cachedEvents,
          layers,
        };

        try {
          await Filesystem.mkdir({ path: CACHE_DIR_PATH, directory: Directory.Data, recursive: true });
        } catch {
          // recursive:true deckt "existiert schon" bereits ab - hier nur zusätzliches Sicherheitsnetz.
        }

        await Filesystem.writeFile({
          path: CACHE_FILE_PATH,
          data: JSON.stringify(cache),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
      } catch (err) {
        console.error('Offline-Kalender-Cache konnte nicht geschrieben werden:', err);
      }
    }

    writeCache();
  }, [events, layers]);

  return null;
}
```

- [ ] **Step 3: Mount it from `kalender-with-layers-online.tsx`**

```diff
  import { KalenderWithLayers, type CalendarLayer } from './kalender-with-layers';
+ import { OfflineCacheSync } from './offline-cache-sync';
  import type { CalendarEventInput } from './calendar-view';
```

```diff
    const router = useRouter();
-   return <KalenderWithLayers events={events} layers={layers} onNavigate={(path) => router.push(path)} />;
+   return (
+     <>
+       <OfflineCacheSync events={events} layers={layers} />
+       <KalenderWithLayers events={events} layers={layers} onNavigate={(path) => router.push(path)} />
+     </>
+   );
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed. Then, on a physical Android device or emulator with this build installed
and pointed at a reachable backend (`CAPACITOR_TARGET=dev npx cap sync android`, run from Android
Studio per this session's established device-testing flow): open the Kalender page while online,
then confirm the file was written:
```bash
adb shell run-as at.bfkdostpoelten.app cat files/offline-cache/kalender.json
```
Expected: valid JSON with a `syncedAt` timestamp, an `events` array containing only events whose
`end` is within the last 30 days or in the future, and a `layers` array matching what the page
showed (e.g. `own`/`abschnitt`, plus `drohnengruppe` if the test user is a Drohnengruppe member).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/calendar/offline-cache-sync.tsx src/components/calendar/kalender-with-layers-online.tsx
git commit -m "feat: write offline calendar cache on native Android"
```

---

### Task 3: Scaffold the standalone Vite offline bundle

**Files:**
- Create: `vite.config.ts`
- Create: `native-offline/main.tsx`
- Create: `native-offline/index.html`
- Modify: `package.json` (scripts, devDependencies)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `KalenderWithLayers` (`src/components/calendar/kalender-with-layers.tsx`, unchanged from
  Task 1), `globals.css`/`tailwind.config.ts` (unchanged, reused as-is).
- Produces: `native-fallback/offline-app/index.html` + hashed JS/CSS assets (the Vite build output;
  git-ignored, built fresh before every `cap sync`) — Task 4 finishes this entry point's actual logic
  (currently a hardcoded sample render, so this task's own build/render can be verified in isolation
  before Task 4 wires up the real cache read).

- [ ] **Step 1: Add Vite devDependencies**

```bash
npm install -D vite@^6 @vitejs/plugin-react@^4
```

- [ ] **Step 2: Create `vite.config.ts` at the repo root**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Eigenständiges Build für die Offline-Kalender-Ansicht (native Android, siehe
// docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md). Läuft neben dem
// bestehenden Next.js-Build, nicht als Ersatz - `npm run build` (Next.js) bleibt unverändert.
export default defineConfig({
  root: 'native-offline',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'native-fallback/offline-app'),
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Create `native-offline/index.html`**

Note: no `<link>` to `globals.css` here — with `root: 'native-offline'` (Step 2), an absolute
`href="/src/app/globals.css"` would resolve against `native-offline/` itself, not the repo root, and
silently fail to find the real file at build time. The CSS is imported from `main.tsx` instead
(Step 4), which Vite resolves correctly through the JS module graph regardless of `root`.

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Offline – Kalender</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `native-offline/main.tsx` (placeholder render, finished in Task 4)**

```tsx
import '../src/app/globals.css';
import { createRoot } from 'react-dom/client';
import { KalenderWithLayers } from '@/components/calendar/kalender-with-layers';

// Platzhalter für diesen Task: rendert KalenderWithLayers mit leeren Daten, um Build + Styling zu
// verifizieren. Task 4 ersetzt dies durch das echte Lesen von offline-cache/kalender.json plus die
// drei Zustände (kein Cache / Cache vorhanden / Lesefehler).
const root = createRoot(document.getElementById('root')!);
root.render(<KalenderWithLayers events={[]} layers={[]} readOnly />);
```

- [ ] **Step 5: Add the `build:offline` script and fold it into the existing sync scripts**

```diff
    "scripts": {
      "dev": "next dev",
      "build": "next build",
+     "build:offline": "vite build",
      "start": "next start",
      "lint": "next lint",
      "db:migrate": "prisma migrate dev",
      "db:deploy": "prisma migrate deploy",
      "db:seed": "node node_modules/tsx/dist/cli.mjs prisma/seed.ts",
      "db:studio": "prisma studio",
      "postinstall": "prisma generate",
-     "cap:sync:prod": "cross-env CAPACITOR_TARGET=prod npx cap sync",
-     "cap:sync:dev": "cross-env CAPACITOR_TARGET=dev npx cap sync",
+     "cap:sync:prod": "npm run build:offline && cross-env CAPACITOR_TARGET=prod npx cap sync",
+     "cap:sync:dev": "npm run build:offline && cross-env CAPACITOR_TARGET=dev npx cap sync",
      "cap:open:ios": "npx cap open ios",
      "cap:open:android": "npx cap open android"
    },
```

This matches the existing target-based naming convention instead of inventing a platform-specific
script name — both existing sync scripts now always rebuild the offline bundle first, so it can
never be forgotten before a native build (the same class of mistake this repo has already hit twice
with docker-compose env vars, per the root CLAUDE.md).

- [ ] **Step 6: Ignore the build output**

```diff
  # (append to .gitignore, near the other build-output entries)
+ /native-fallback/offline-app/
```

- [ ] **Step 7: Verify the build**

```bash
npm run build:offline
```
Expected: succeeds, produces `native-fallback/offline-app/index.html` plus a `assets/` directory
with hashed `.js`/`.css` files. Open that `index.html` directly in a desktop browser (e.g.
`start native-fallback/offline-app/index.html` on Windows, or drag it into a browser tab): the page
should render an empty calendar (`KalenderWithLayers` with `events: []` shows its "Keine Termine
vorhanden." list state and an empty grid), styled with the same Tailwind colors/fonts as the main
app (falling back to `system-ui` for the font, per the design spec — Barlow itself won't load since
`next/font` doesn't run here). No console errors about `next/navigation`, `next/link`, or a missing
router.

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts native-offline package.json package-lock.json .gitignore
git commit -m "feat: scaffold standalone Vite bundle for offline calendar view"
```

---

### Task 4: Offline entry point, cache read, and `capacitor.config.ts` wiring

**Files:**
- Modify: `native-offline/main.tsx`
- Create: `native-offline/OfflineKalenderApp.tsx`
- Modify: `capacitor.config.ts`

**Interfaces:**
- Consumes: `OfflineKalenderCache` type and the `offline-cache/kalender.json` path (Task 2's
  `offline-cache-sync.tsx`), `KalenderWithLayers` (Task 1), `MobileHeaderProvider`/`useMobileHeader`
  (`src/components/layout/mobile-header-context.tsx`, unchanged, already portable).
- Produces: the finished offline entry point rendered at `native-fallback/offline-app/index.html`.

- [ ] **Step 1: Create `native-offline/OfflineKalenderApp.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { KalenderWithLayers } from '@/components/calendar/kalender-with-layers';
import { MobileHeaderProvider, useMobileHeader } from '@/components/layout/mobile-header-context';
import type { OfflineKalenderCache } from '@/components/calendar/offline-cache-sync';

const CACHE_FILE_PATH = 'offline-cache/kalender.json';

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; cache: OfflineKalenderCache };

function useOfflineCache(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await Filesystem.readFile({
          path: CACHE_FILE_PATH,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        const cache = JSON.parse(result.data as string) as OfflineKalenderCache;
        if (!cancelled) setState({ status: 'ready', cache });
      } catch {
        // Datei fehlt (nie online synchronisiert) oder ist beschädigt - in beiden Fällen dieselbe
        // "kein Cache"-Meldung statt eines Absturzes, siehe Design-Spec, Abschnitt "Daten-Fluss:
        // Offline anzeigen".
        if (!cancelled) setState({ status: 'empty' });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
}

function goOnline() {
  window.location.href = '/';
}

function OfflineHeader({ syncedAt }: { syncedAt: string | null }) {
  const { actionSlot } = useMobileHeader();
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-200 bg-[#1c1c1e] px-4 py-3 text-white">
      <div className="flex flex-col">
        <span className="text-sm font-semibold">Offline-Ansicht</span>
        {syncedAt && <span className="text-xs text-neutral-300">Stand: {formatSyncedAt(syncedAt)}</span>}
      </div>
      <div className="flex items-center gap-2">
        {actionSlot}
        <button
          type="button"
          onClick={goOnline}
          className="rounded bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
        >
          Erneut verbinden
        </button>
      </div>
    </div>
  );
}

function OfflineKalenderContent() {
  const state = useOfflineCache();

  if (state.status === 'loading') {
    return (
      <>
        <OfflineHeader syncedAt={null} />
        <div className="p-4 text-sm text-neutral-500">Lädt…</div>
      </>
    );
  }

  if (state.status === 'empty') {
    return (
      <>
        <OfflineHeader syncedAt={null} />
        <div className="p-4">
          <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
            Noch keine Daten zwischengespeichert — bitte einmal mit Internetverbindung öffnen.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <OfflineHeader syncedAt={state.cache.syncedAt} />
      <div className="p-4">
        <KalenderWithLayers events={state.cache.events} layers={state.cache.layers} readOnly />
      </div>
    </>
  );
}

export function OfflineKalenderApp() {
  return (
    <MobileHeaderProvider>
      <div className="min-h-screen bg-[#f6f6f7]">
        <OfflineKalenderContent />
      </div>
    </MobileHeaderProvider>
  );
}
```

- [ ] **Step 2: Wire the real entry point in `native-offline/main.tsx`**

```tsx
import '../src/app/globals.css';
import { createRoot } from 'react-dom/client';
import { OfflineKalenderApp } from './OfflineKalenderApp';

const root = createRoot(document.getElementById('root')!);
root.render(<OfflineKalenderApp />);
```

- [ ] **Step 3: Point `capacitor.config.ts`'s `errorPath` at the new bundle**

```diff
    server: {
      url: ORIGINS[TARGET],
      cleartext: false,
-     errorPath: 'offline.html',
+     errorPath: 'offline-app/index.html',
    },
```

Leave `native-fallback/offline.html` itself in place (unused by `errorPath` after this change, but
kept as a safety fallback asset — no reason to delete a working file for a hypothetical future need).

- [ ] **Step 4: Rebuild and verify the bundle in isolation**

```bash
npm run build:offline
```
Expected: succeeds. Manually place a valid `OfflineKalenderCache` JSON string as this device's
`offline-cache/kalender.json` (either by first completing Task 2's on-device verification so the
real app writes one, or by pushing a hand-written test file via `adb push`), then load
`native-fallback/offline-app/index.html` on a physical device or emulator through the Capacitor
build (not a desktop browser this time, since `@capacitor/filesystem` needs the native bridge) —
confirm the header shows "Offline-Ansicht — Stand: ..." with the correct formatted timestamp, the
calendar (grid + list) renders the cached events, and the layer/status filters and view toggle work.

- [ ] **Step 5: End-to-end on-device verification (per the design spec's test plan)**

Using a physical Android device with this build installed (matching this session's established
device-testing flow — `CAPACITOR_TARGET=dev npx cap sync android` or `prod`, then run from Android
Studio or a signed build):

1. Open the Kalender page online, confirm (via Task 2's `adb shell run-as` check) the cache file
   exists.
2. Enable flight mode, then either restart the app or navigate to any page that requires a live
   request — the WebView's load failure should trigger `errorPath`, showing the offline Kalender
   view with the previously cached events and the correct "Stand: ..." timestamp.
3. Toggle grid/list view and the layer/status filters — confirm they still work with no console
   errors.
4. Confirm a previously-RSVP'd event shows its `RsvpBadge`/status pill (read-only), with no
   Zusage/Absage buttons, no "Neuer Termin", no `.ics` icon anywhere in the offline view.
5. On a device/profile that has never opened the app online (no cache file), confirm flight mode +
   any failed navigation shows the "Noch keine Daten zwischengespeichert…" message, not a blank or
   broken page.
6. Disable flight mode, tap "Erneut verbinden" — confirm the app returns to the live, fully
   interactive Kalender page.

- [ ] **Step 6: Commit**

```bash
git add native-offline capacitor.config.ts
git commit -m "feat: finish offline calendar entry point and wire errorPath"
```
