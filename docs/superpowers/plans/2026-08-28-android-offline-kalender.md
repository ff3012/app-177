# Android Offline-Kalender (Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Kalender view readable offline in the native Android app by reusing the existing
calendar display components on a dedicated offline page, served from the app's own live origin via
an extended service worker, reading a locally-cached JSON snapshot.

**Architecture:** `CalendarView`/`EventListView`/`KalenderWithLayers` become router-agnostic and gain
a `readOnly` mode (fully additive — existing online behavior is unchanged when omitted) — **Tasks 1
and 2 below are already implemented and merged onto this branch, unchanged by this revision.**
A new Android-only effect writes a time-bounded JSON snapshot of the already-loaded calendar data to
disk via `@capacitor/filesystem` on every normal online visit (Task 2). **Revision (see
`docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md` for the full rationale): the
original Tasks 3-4 (a separate Vite bundle served via `capacitor.config.ts`'s `server.errorPath`)
were discarded before merge — the final whole-branch review found, by reading Capacitor's own
Android Java source, that the `errorPath` page's subresources fall through to the network (fails
offline) and its origin never receives Capacitor's bridge injection (so `@capacitor/filesystem`
could never read the cache).** The replacement Tasks 3-4 below instead add a genuine Next.js static
page (`/offline-kalender`, public, outside the `(app)` route group) that imports the same display
components, and extend the existing hand-written service worker (`public/sw.js`) to precache that
page's assets and serve it — from the same live origin, so the bridge and local storage are both
present — when a navigation fetch fails.

**Tech Stack:** Next.js App Router (existing, no new build tool), React 19, `@capacitor/filesystem`
(added in Task 2), the existing hand-written service worker (`public/sw.js`, extended — no Workbox/
`next-pwa` introduced), Tailwind v3 (reused config), existing `CalendarEventInput` type.

## Global Constraints

- Read-only only: no offline RSVP, event create/edit, or `.ics` download — those require the server
  and stay online-only.
- Native-Android-focused: no new iOS-specific work and no iOS-specific testing. Tasks 3-4 (revised)
  do touch the shared `public/sw.js`/`components/pwa-register.tsx` service-worker path — narrowly,
  and only to add passive offline-fallback caching — since serving the offline page from the live
  origin (rather than a separate local bundle) is what avoids the Capacitor bridge/origin problem
  that sank the original approach. This is a deliberate, reasoned exception to the earlier
  Android-only framing, not scope creep — see the design spec's "Service-Worker-Registrierung auf
  Android" section for the full reasoning.
- Every change to `CalendarView`/`EventListView`/`KalenderWithLayers` must be additive — when
  `readOnly` is omitted/`false` and `onNavigate` behaves like today's `router.push`, the rendered
  online output must be unchanged. (Already satisfied by Task 1, unaffected by this revision.)
- Cache filter uses the event's `end` field, not `start` (`end >= heute - 30 Tage`), so a multi-day
  event that started before the window but ends within/after it is not dropped. (Task 2, unaffected.)
- No new automated tests — this repo has none; verification is `npx tsc --noEmit`, `npm run build`,
  and manual on-device testing (flight mode) per Task 4.
- Reuse the existing `CalendarEventInput` type and existing Tailwind tokens/`globals.css` — no new
  color or type definitions, no new build tooling/devDependencies.

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

### Task 3: Extend the service worker to precache and serve the offline Kalender page

**Files:**
- Modify: `public/sw.js`
- Modify: `src/components/pwa-register.tsx`

**Interfaces:**
- Consumes: nothing from Task 1/2 directly — this task only touches the service worker and its
  registration. It depends on Task 4's `/offline-kalender` route existing at that exact URL, but
  Task 3 can be implemented and committed first since `fetch('/offline-kalender')` failing during
  `install` is handled gracefully (best-effort, matching the rest of this feature's error handling)
  — the precache step simply does nothing useful until Task 4 lands, without breaking the service
  worker itself.
- Produces: an updated `public/sw.js` that precaches `/offline-kalender` and its referenced
  `/_next/` assets, and serves them for any failed navigation. `src/components/pwa-register.tsx`
  registers the service worker on Android (previously skipped there).

- [ ] **Step 1: Rewrite `public/sw.js`**

Replace the entire file with:

```js
const CACHE_NAME = 'ff-purkersdorf-shell-v3';
const OFFLINE_URL = '/offline.html';
const OFFLINE_KALENDER_URL = '/offline-kalender';
const STATIC_PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

// Next.js baut /offline-kalender mit inhaltsgehashten JS/CSS-Dateien (_next/static/...) - die
// exakten Dateinamen sind erst zur Build-Zeit bekannt, nicht vorher fest eintragbar. Statt eines
// zusätzlichen Build-Schritts (Workbox o.ä., bewusst nicht eingeführt - siehe root CLAUDE.md,
// "hand-written, no next-pwa/similar dependency") liest dieser Schritt die tatsächlich
// ausgelieferte HTML-Antwort und cached jede darin referenzierte /_next/-Datei mit. Fragil
// gegenüber Änderungen an Next.js' HTML-Struktur, aber für diesen Piloten bewusst akzeptiert -
// siehe docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
async function precacheOfflineKalender(cache) {
  try {
    const response = await fetch(OFFLINE_KALENDER_URL);
    if (!response.ok) return;
    const html = await response.clone().text();
    await cache.put(OFFLINE_KALENDER_URL, response);
    const assetUrls = [...html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(
      assetUrls.map((url) =>
        fetch(url)
          .then((res) => res.ok && cache.put(url, res))
          .catch(() => {})
      )
    );
  } catch {
    // best-effort - siehe Kommentar oben. Ohne vollständigen Precache zeigt der Offline-Fallback
    // ggf. eine unvollständig gestylte Seite, aber keinen Absturz.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_PRECACHE_URLS).then(() => precacheOfflineKalender(cache)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Navigationen: network-first mit Offline-Fallback (bevorzugt /offline-kalender, sonst die alte
// bare offline.html). /_next/-Assets: ebenfalls network-first, aber bei Fehlschlag aus dem Cache
// bedient, falls sie beim Precache-Schritt oben mitgesichert wurden - das deckt genau die JS/CSS-
// Dateien ab, die /offline-kalender zum Rendern braucht. Alles andere (API-Calls, Server Actions,
// POST, Bilder, sonstige Assets) bleibt unangetastet, damit keine veralteten Daten/Formulare
// zwischengespeichert werden.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isNavigation = event.request.mode === 'navigate';
  const isNextStaticAsset = new URL(event.request.url).pathname.startsWith('/_next/');
  if (!isNavigation && !isNextStaticAsset) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      if (isNavigation) {
        const kalender = await caches.match(OFFLINE_KALENDER_URL);
        return kalender || (await caches.match(OFFLINE_URL));
      }
      return caches.match(event.request);
    })
  );
});

// News-Modul: eingehende Web-Push-Nachricht als Benachrichtigung anzeigen. data.url (falls vorhanden)
// wird an showNotification durchgereicht, damit notificationclick unten weiß, wohin ein Tap führen soll.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'BFKDO St. Pölten', body: '' };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data,
    })
  );
});

// Klick auf die Benachrichtigung: öffnet/fokussiert data.url (die konkrete News-Meldung), fällt auf
// /kalender zurück, falls keine data.url mitgeschickt wurde (z. B. der ältere, News-unabhängige
// Kalender-Sofortversand). Ein bereits offenes Fenster wird fokussiert UND zur Ziel-URL navigiert -
// focus() allein würde die zuvor geöffnete Seite unverändert lassen. navigate() kann ablehnen (z. B. bei
// einem Fenster, das dieser Service Worker nicht kontrolliert) - in dem Fall auf openWindow() zurückfallen
// statt den Nutzer stillschweigend auf der alten Seite sitzen zu lassen (genau der Bug, den dieses
// Feature eigentlich beheben soll).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/kalender';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        return existing
          .focus()
          .then(() => existing.navigate(url))
          .catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })
  );
});
```

The only functional changes from the current file: `CACHE_NAME` bumped `v2` → `v3` (forces old
caches to be purged on next activate, since `STATIC_PRECACHE_URLS` content changed), the new
`OFFLINE_KALENDER_URL`/`precacheOfflineKalender` precache step, and the `fetch` handler now also
matches `/_next/` GET requests (network-first, cache-fallback) in addition to navigations. The
`push`/`notificationclick` handlers are untouched — copy them verbatim.

- [ ] **Step 2: Register the service worker on Android in `pwa-register.tsx`**

Replace the whole file:

```tsx
'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export function PwaRegister() {
  useEffect(() => {
    // Android registriert den Service Worker jetzt ebenfalls (siehe
    // docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md, "Service-Worker-
    // Registrierung auf Android") - eng gefasst auf einen reinen Offline-Fallback-Cache (siehe
    // sw.js), um die ursprüngliche Sorge (zwei konkurrierende Installationsmechanismen) nicht
    // wieder einzuführen. iOS bleibt ausgenommen: dort übernimmt weiterhin ausschließlich die
    // native Capacitor-Hülle die "installierte App"-Rolle - kein Offline-Kalender-Pilot für iOS.
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registrierung ist best-effort; ohne SW funktioniert die App normal weiter.
      });
    }
  }, []);

  return null;
}
```

The only change from the current file: the early-return condition narrows from "any native
platform" to "native AND iOS" — web and Android both now proceed to registration (web already did;
Android is the new case).

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed. This task's real effect (precache behavior, offline serving) cannot be
verified until Task 4's `/offline-kalender` route exists — `npm run build` succeeding and the
service worker file being valid JS is the only automated check available at this point. Also
confirm by reading the diff that no other behavior in `sw.js` changed (push/notificationclick
handlers byte-identical to before).

- [ ] **Step 4: Commit**

```bash
git add public/sw.js src/components/pwa-register.tsx
git commit -m "feat: extend service worker to precache and serve offline Kalender page"
```

---

### Task 4: Build the `/offline-kalender` page and wire it into the public routes

**Files:**
- Create: `src/app/offline-kalender/page.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `OfflineKalenderCache` type and the `offline-cache/kalender.json` path (Task 2's
  `offline-cache-sync.tsx`), `KalenderWithLayers` (Task 1), `MobileHeaderProvider`/`useMobileHeader`
  (`src/components/layout/mobile-header-context.tsx`, unchanged, already portable — confirmed by the
  original Task 4's since-discarded work, same reasoning still applies), Task 3's
  `precacheOfflineKalender` (which fetches this exact route by URL — the route must live at
  `/offline-kalender`, matching `OFFLINE_KALENDER_URL` in `public/sw.js`).
- Produces: the finished offline entry point at `/offline-kalender`, publicly reachable (no
  `requireUser()` gate) so the service worker's `install`-time precache fetch always succeeds
  regardless of session state.

- [ ] **Step 1: Create `src/app/offline-kalender/page.tsx`**

```tsx
'use client';

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
        if (cancelled) return;
        if (Array.isArray(cache.events) && Array.isArray(cache.layers)) {
          setState({ status: 'ready', cache });
        } else {
          setState({ status: 'empty' });
        }
      } catch (err) {
        // Datei fehlt (nie online synchronisiert), ist beschädigt, oder JSON.parse schlägt fehl -
        // in allen Fällen dieselbe "kein Cache"-Meldung statt eines Absturzes. console.error bleibt
        // für Logcat-Sichtbarkeit beim Debuggen auf einem echten Gerät erhalten (Finding aus dem
        // vorherigen Task-4-Review: ein leerer catch{} macht "nie synchronisiert" von "Cache
        // beschädigt" nicht mehr unterscheidbar).
        console.error('Offline-Kalender-Cache konnte nicht gelesen werden:', err);
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

function reload() {
  // Lädt dieselbe URL neu - kommt der Request diesmal durch (Netz wieder da), liefert der
  // Service Worker die echte, live gerenderte Seite statt der gecachten Offline-Antwort.
  window.location.reload();
}

function OfflineHeader({ syncedAt }: { syncedAt: string | null }) {
  const { actionSlot } = useMobileHeader();
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-200 bg-[#1c1c1e] px-4 py-3 pt-safe text-white">
      <div className="flex flex-col">
        <span className="text-sm font-semibold">Offline-Ansicht</span>
        {syncedAt && <span className="text-xs text-neutral-300">Stand: {formatSyncedAt(syncedAt)}</span>}
      </div>
      <div className="flex items-center gap-2">
        {actionSlot}
        <button
          type="button"
          onClick={reload}
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

export default function OfflineKalenderPage() {
  return (
    <MobileHeaderProvider>
      <div className="min-h-screen bg-[#f6f6f7]">
        <OfflineKalenderContent />
      </div>
    </MobileHeaderProvider>
  );
}
```

This route is a top-level segment (`src/app/offline-kalender/`, a sibling of `(app)`/`(auth)`/
`drohnen-schnell`), so it automatically inherits only the root `src/app/layout.tsx` (fonts, global
styles, `<PwaRegister/>`, `<AndroidBackButton/>`, etc.) and NOT `(app)/layout.tsx`'s header/nav/
`requireUser()` gate — same mechanism already used by `drohnen-schnell/[token]`, no new layout file
needed.

- [ ] **Step 2: Add `/offline-kalender` to `middleware.ts`'s public paths**

```diff
  const PUBLIC_PATH_PREFIXES = [
    '/login',
    '/api/auth',
    '/api/health',
    '/kalender/ics',
    '/aktivieren',
    '/passwort-vergessen',
    '/passwort-zuruecksetzen',
    '/datenschutz',
    '/drohnen-schnell',
    '/api/cron',
    '/dashboard',
    '/api/wastl',
    '/api/facebook/image',
    '/fahrzeug-reservierung',
    '/how-to.html',
+   '/offline-kalender',
```

This is required, not just convenient: the service worker's `install`-time `fetch('/offline-kalender')`
(Task 3) must succeed regardless of whether that request carries a valid session cookie — if this
route stayed behind the default auth gate, a precache attempt before login (or after a session
expired) would silently cache the login-redirect page instead of the real offline content. The page
itself displays only locally-cached device data and calls no server API, so making it publicly
reachable has no confidentiality implication.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed, and the build's route table includes a new static/prerendered entry for
`/offline-kalender` (look for a `○` or similar static marker in the build output, not `ƒ`/dynamic —
confirms Next.js recognized this as a page with no server data dependency, which is what makes it
cacheable as a fixed response).

Then start the dev server (`npm run dev`) and open `http://localhost:3000/offline-kalender`
directly in a browser: it should render without requiring login, showing the "Noch keine Daten
zwischengespeichert…" empty state (no `@capacitor/filesystem` bridge in a plain browser, so the
read always lands in `catch`) with no console errors — this confirms the page itself is
structurally sound before testing the full service-worker/native flow.

- [ ] **Step 4: On-device end-to-end verification**

Using a physical Android device with this build installed (`CAPACITOR_TARGET=dev npx cap sync
android` or `prod`, then run from Android Studio or a signed build — matching this session's
established device-testing flow):

1. Open the app online at least once (any page) so the service worker registers and its `install`
   step runs — confirm via `chrome://inspect` → Application tab → Service Workers (should show
   `sw.js` activated) and Cache Storage (should show `/offline-kalender` plus its `/_next/` assets
   under `ff-purkersdorf-shell-v3`).
2. Open the Kalender page online, confirm (via `adb shell run-as at.bfkdostpoelten.app cat
   files/offline-cache/kalender.json`, per Task 2) the cache file exists.
3. Enable flight mode, navigate to any page (or restart the app) — the failed navigation should be
   served the cached `/offline-kalender` page, showing the previously cached events and the correct
   "Stand: ..." timestamp.
4. Toggle grid/list view and the layer/status filters — confirm they still work with no console
   errors.
5. Confirm a previously-RSVP'd event shows its `RsvpBadge`/status pill (read-only), with no
   Zusage/Absage buttons, no "Neuer Termin", no `.ics` icon anywhere.
6. On a device/profile that has never opened the app online (no cache file, but the service worker
   has still precached the shell on its first install), confirm flight mode + a failed navigation
   shows the "Noch keine Daten zwischengespeichert…" message, not a blank or broken page.
7. Disable flight mode, tap "Erneut verbinden" — confirm the app returns to the live, fully
   interactive page it originally tried to reach.
8. As a final sanity check specifically for the bug the previous approach had: confirm step 3 above
   actually shows real calendar data (not a permanent empty state) — this is the exact failure mode
   the original `errorPath`-based design would have hit silently.

- [ ] **Step 5: Commit**

```bash
git add src/app/offline-kalender/page.tsx src/middleware.ts
git commit -m "feat: add public offline-kalender page served via service worker"
```
