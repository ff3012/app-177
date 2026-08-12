# CLAUDE.md — Kalender module

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### Kalender module

`src/app/(app)/kalender/page.tsx` is the single calendar page (an earlier separate `/kalender/abschnitt` page
was merged in and now just redirects here). It fetches every event the user is allowed to see, tags each
with a `layer` (`own` / `abschnitt` / `drohnengruppe`) and a `category`, and hands them (plus the built
`icsLinks` array, see below) to `components/calendar/kalender-with-layers.tsx`, a client component that
renders the layer/legend/ICS sidebar and either `CalendarView` (FullCalendar grid) or `EventListView`
(compact `table-fixed` table: Datum/Start/Tag/Betreff/Organisation/Zusagen-Badge, `text-xs` with tight
padding so it stays inside the page's `max-w-5xl` column without horizontal scrolling) depending on a
`viewMode` toggle — **list is the default view** for all users, not the calendar grid. Adding a new layer
means: extend the `layer` tagging logic in the page, add it to the `layers` array passed down, and add a
color to `src/lib/calendar/layer-colors.ts`'s `LAYER_COLORS`/`LAYER_LABELS` (the single source both the
event `backgroundColor`, `LayerLegend`, and the mobile `EventCard`'s accent bar read from — never hardcode a
layer color at any of those three call sites again). Every `EventListView` row is clickable regardless of
`event.editable` — a single click opens the detail page (RSVP + full info, see below), a double-click on an
editable row instead jumps straight to the edit form. Since a browser fires two ordinary `click` events
before recognizing a `dblclick`, the single-click navigation is deferred by `DOUBLE_CLICK_WINDOW_MS` (220ms)
in `EventListRow` and cancelled if a `dblclick` arrives in that window — don't remove that debounce, a plain
`onClick` would navigate away before the `dblclick` handler ever fires. Rows also carry an explicit "Zusage"
link to the same detail page next to the add-to-calendar icon, for discoverability. `RsvpBadge`
(`components/calendar/rsvp-badge.tsx`) is shared by the table row, the mobile card, and the FullCalendar
month-grid chip (see below) via a `compact` prop (plain colored text instead of pill backgrounds, for the
tighter chip context) — don't reintroduce a local copy at any of those sites.

**Kalender V2 (Signalrot-Mockup-Angleichung)** — sidebar layout, color/legend alignment, and the FullCalendar
reskin below were all one pass, done after the Drohnengruppe module's own equivalent pass ("Drohnengruppe
V2" in that section) and before News/Verwaltung's still-pending ones. Same relationship as "Signalrot"
V1 (color/font) → V2 (mobile nav) above: V1 here was the module's original build (everything described
earlier in this section); V2 is this mockup-alignment work specifically.

**Sidebar layout** (`kalender-with-layers.tsx`): at `lg:` (1024px) and up — the first use of that breakpoint
anywhere in this codebase, everywhere else only uses `sm:` (640px) — the Ebenen-Toggles, `LayerLegend`, and
the ICS-subscribe card move into a fixed `lg:w-64` left column next to the calendar/list content. Between
`sm:` and `lg:` (tablet width, 640–1023px) that same content still stacks in the original order — there's
deliberately no third in-between layout for that range. **Below `sm:` (640px, phone width) this stacked
fallback no longer applies at all** — see "Kalender V3 (Mobile-Brief.md)" below, which replaced it with a
Bottom Sheet; the wrapper is `hidden lg:flex` (not just the old stacked-card block), so below `lg:` it's
either the tablet stack (640–1023px) or fully hidden behind the sheet (<640px). `lg:` was chosen specifically
because the page's own container is `max-w-5xl` (1024px) — the sidebar only gets meaningful room right around
where the container hits its own cap anyway, so there's no cramped intermediate range to design for. The ICS
links themselves moved from `kalender/page.tsx`'s own JSX into `KalenderWithLayers` as a plain
`icsLinks: {label, href, copyText}[]` prop built server-side in `page.tsx` — purely a component-boundary
change, not a functional one.

**FullCalendar reskin** (`calendar-view.tsx`, v6.1.21): `eventDisplay="block"` (solid colored chips instead
of the library's default dot+text) plus a custom `eventContent` render callback that shows `HH:mm Titel` and
— only when `arg.view.type === 'dayGridMonth'` **and** the event's category is `DROHNENGRUPPE` — a compact
`RsvpBadge` line underneath. The `view.type` check matters: `eventContent` fires for both `dayGridMonth` and
`timeGridWeek` (same `<FullCalendar>` instance, switched via the toolbar), and `timeGridWeek`'s taller
time-block layout was never addressed by the design this followed, so it deliberately keeps the plain
time+title there. `extendedProps` on each event now also carries `rsvpCounts`/`category` (previously only
`editable`) specifically so `eventContent` can read them — `EventContentArg.event.extendedProps` is the only
way in. Weekend-column tinting (`.fc-day-sat`/`.fc-day-sun`) and muted out-of-month-cell text
(`.fc-day-other`) are plain CSS in `globals.css` targeting FullCalendar's own generated class names
(confirmed from `@fullcalendar/core`'s source, not guessed) — `!important` for the same reason as the
pre-existing mobile toolbar override just above them in that file: FullCalendar injects its own stylesheet
at runtime, so normal bundle cascade order isn't guaranteed to win.

**Kalender V3 (Mobile-Brief.md)** — a follow-up mobile-only pass, done after a real phone screenshot of
Kalender V2 showed its "stacked sidebar cards above the content" fallback meant a user opened Kalender and
saw three settings cards before a single event — the mobile view was still a wrapped desktop layout, not
its own design. Scope: phones only (`sm:`, i.e. <640px — the brief itself said "<768px" but that's treated as
an approximate figure, not a new breakpoint, to avoid opening a gap in the untouched 640–1023px tablet range
described above); `sm:` and up is explicitly unchanged, verified via computed-style diffing before/after.

- **Sidebar dissolved into a Bottom Sheet**: the Ebenen/Legende/ICS content (now extracted into
  `components/calendar/kalender-filters-content.tsx`, `<KalenderFiltersContent>`, reused by both the desktop
  sidebar and the sheet so the JSX/logic exists exactly once) moved out of the phone-width content flow
  entirely. A funnel-icon button — registered into the shared mobile header's action slot (see "Shared:
  Mobile header context" below) only while `KalenderWithLayers` is mounted, with a small red dot when
  `Object.values(enabled).some(v => v === false)` — opens `components/ui/bottom-sheet.tsx`'s `<BottomSheet>`
  containing the exact same `<KalenderFiltersContent>`. Content now appears first on phones: title, segmented
  view toggle, then events — settings are one tap away instead of blocking the scroll.
- **View toggle recolored + repositioned on mobile**: since the sidebar no longer occupies the phone-width
  content flow, the Kalenderansicht/Listenansicht segmented control (still the first thing in the content
  column) is now full-width with equal segments and a **white-on-gray active state** below `sm:` (`bg-white
  text-neutral-900 shadow-sm` on a `bg-neutral-100` track) — red stays reserved for primary actions/the
  active tab per the brief. `sm:` and up keeps the original `bg-brand text-white` fill unchanged.
- **`ToggleSwitch`** (`components/ui/toggle-switch.tsx`) rows are `flex w-full justify-between min-h-11`
  below `sm:` (label left, switch right-aligned, 44px min tap target) with `sm:inline-flex sm:w-auto
  sm:min-h-0 sm:justify-start` restoring the exact previous compact desktop look. Its active-track color is
  now `bg-status-green` (new `status.green` = `#22a06b` Tailwind token, same green as
  `LAYER_COLORS.drohnengruppe`/`NinetyDayRing`) below `sm:`, `sm:bg-brand` (red, unchanged) above it. This is
  a genuinely shared component also used by Drohnengruppe's "Alle Flüge einsehen" toggle
  (`flight-table.tsx`) — its mobile color changed too, deliberately, since the brief's "red only for primary
  actions + the active tab" rule wasn't scoped to Kalender specifically.
- **Card density** (mobile only): Ebenen/Legende/ICS cards and the mobile event-card list wrapper went from
  `rounded-lg p-3` to `rounded-xl p-4` below `sm:` (`sm:rounded-lg sm:p-3` restores the old desktop values) —
  Kalender-scoped only, matching the module-by-module pattern; Drohnengruppe/News/Verwaltung keep their
  current card sizing until their own future mobile passes.

**Vergangene Termine ausblenden (GitHub issue #1)**: in `KalenderWithLayers`, `sortedEvents` (fed to
`EventListView`) unconditionally drops events whose `end` is before `Date.now()` — no toggle, always on.
`filteredEvents` (fed to `CalendarView`, the FullCalendar grid) is untouched and keeps showing every month in
full. This split is a deliberate product decision, not an oversight: a month grid with past days/events
blanked out reads as broken rather than tidy, whereas the list is exactly the "wall of old entries" the issue
complained about. An earlier version of this exposed a "Vergangene Termine anzeigen" toggle in
`KalenderFiltersContent` to re-enable past events in the list — removed again shortly after, since the list
view should simply never show them; don't reintroduce that toggle without checking this history first.

**Kalender V4 (Desktop-Browser-Ansicht, `Kalender Browser.dc.html`)** — a follow-up pass scoped exclusively
to `lg:` (1024px) and up, replacing the flat table with the same date-block/color-strip/inline-RSVP language
the mobile card already used. Tablet (640–1023px) and mobile (<640px) code paths are untouched by this pass —
full rationale in `docs/superpowers/specs/2026-08-09-kalender-desktop-browser-design.md`.

- **Month-grouped list** (`event-list-view.tsx`): `DesktopMonthList`/`DesktopEventRow`, rendered from a new
  `hidden lg:block` wrapper alongside (not replacing) the existing `sm:block lg:hidden` tablet table and
  `sm:hidden` mobile card list — all three read from the same already-filtered/sorted `events` array, so
  they can't diverge on which events show. `groupEventsByMonth()` buckets the already-chronologically-sorted
  list into consecutive year+month runs (no re-sorting) and each group renders as its own white
  `rounded-lg` card with an uppercase month label ("August 2026") above it. Each row keeps a `5px solid`
  left border in the event's `LAYER_COLORS` shade — the same source `EventCard`'s mobile accent bar and the
  FullCalendar chips already read from, so this is a fourth call site of an existing convention, not a new
  color decision.
- **`KalenderDesktopSidebar`** (`kalender-desktop-sidebar.tsx`, new) is a deliberately separate component
  from `KalenderFiltersContent`, not an `lg:`-branch bolted onto it — `KalenderFiltersContent` keeps serving
  the tablet stack and the mobile `BottomSheet` completely unchanged. The two sidebars' content genuinely
  diverges: the desktop version drops the standalone `LayerLegend` card (its explanation becomes a footnote
  sentence inside the Ebenen card instead — "Die Farbe links am Termin zeigt die Ebene…") and adds a new
  "Nur anzeigen" status-filter card with its own Zugesagt/Abgesagt/Offen color-swatch legend, neither of
  which exists in the tablet/mobile version. Same reasoning already established for `AdminSidebarNav` vs.
  `AdminMobileTabs` in Verwaltung: once two layouts genuinely diverge, a shared component with branches for
  both becomes harder to read than two small, separately named ones.
- **Inline optimistic Zusage/Absage**: `DesktopEventRow`'s Zusage/Absage buttons call `setRsvp(eventId,
  status)` (the same Server Action already used by the event detail page and, since Startbildschirm shipped,
  `HomeTodoList`) directly from the row, no navigation. `DesktopMonthList` holds the same
  `overrideStatus`/`pending` local-state shape `HomeTodoList` already established: set the override
  immediately, await the action, and on `result.error` roll the override back out and show a `sonner` toast
  — this list is the second call site of that exact pattern, not a new one. A successful response needs no
  explicit handling since the next full page load will reflect the real `myRsvpStatus` anyway; the point of
  the override is purely to avoid a visible flash/revert while the request is in flight. Date/title stay
  routed through the existing `useRowClick` (single-click → detail page, double-click → edit if `editable`)
  unchanged — the Zusage/Absage buttons, the `⌄` expand toggle, and the `.ics` icon all call
  `e.stopPropagation()` in their wrapping `<div>` so a click there never also triggers the row's own
  click/dblclick handling.
- **Expand/collapse row**: the `⌄` button toggles a per-row `expanded` boolean (component-local state in
  `DesktopMonthList`, not persisted) that reveals `location`/`description` inline in a `bg-neutral-50` panel
  below the row — both fields already flow into `CalendarEventInput` for other reasons (the edit form, the
  detail page), so no new data fetch was needed, just reading fields the row wasn't displaying yet.
- **Fahrzeug-Reservierungs-Zeilen**: `DesktopEventRow` branches on `event.isVehicleBooking` before rendering
  any RSVP UI at all — no chips, no Zusage/Absage buttons, no `⌄` chevron, just a small "Fahrzeug" label
  pill next to the title and a single "Buchung öffnen" link to the detail page. Consistent with the rest of
  this codebase's vehicle-booking handling (no RSVP concept for these events, see "Fahrzeug-Reservierungen"
  above) rather than a new rule invented for this view specifically.
- **"Offen" (14-day, no-RSVP-yet) definition**: `kalender-with-layers.tsx`'s `isOpenForRsvp()` — visible,
  non-vehicle-booking event starting within 14 days with no `myRsvpStatus` yet — feeds both the sidebar's
  "Offen (n)" chip and the new header subline ("`{n}` Termine · `{n}` offene Rückmeldungen", `lg:`-only).
  This is the **same 14-day window** `HomeTodoList`'s own "Zu erledigen" RSVP todos use
  (`meine-feuerwehr/page.tsx`'s `in14Days`), but **computed independently** in its own function against
  `CalendarEventInput` rather than sharing one helper across both call sites — the two consuming pages pass
  structurally different shapes (`CalendarEventInput` here vs. `HomeEventCardData` there), and introducing a
  shared helper just to unify two three-line predicates over different input types wasn't judged worth the
  indirection. Keep both in sync by hand if the 14-day figure ever changes in one place.
- **`StatusFilter`** (`'ALLE' | 'OFFEN' | 'ZUGESAGT'`, new client state in `KalenderWithLayers`) drives
  `visibleListEvents`, which only the list branches (mobile card, tablet table, and this new `lg:` month
  list) consume — the FullCalendar month grid keeps rendering `filteredEvents` (layer-toggle-filtered only)
  regardless of `statusFilter`, since the grid has no per-cell way to signal "hidden because of RSVP status"
  the way a list row can simply not render. Tablet/mobile never change this state away from its `'ALLE'`
  default (their UI has no chip for it), so the tablet table and mobile card list only ever see the
  unfiltered list in practice — same intent as the design spec's "wirkt sich nur auf den `lg:`-Zweig aus".
- **`LAYER_LABELS` reconciliation**: `layer-colors.ts`'s labels were `'Allgemein · eigene Feuerwehr'`/
  `'Abschnittsweit'` (only ever read by `LayerLegend`) while the Ebenen-Toggle row in
  `KalenderFiltersContent`/`KalenderDesktopSidebar` already showed `'Meine Feuerwehr'`/`'Abschnitt-Kalender'`
  for the very same two layers — a pre-existing inconsistency, not something this pass introduced. Fixed by
  changing `LAYER_LABELS` itself to the toggle's wording, so `LayerLegend` (still shown, unchanged, on
  tablet/mobile) now agrees with the toggle row above it. This is **not** a structural guarantee, though:
  `kalender/page.tsx`'s `layers` array (read by both the Ebenen-Toggle list and `KalenderDesktopSidebar`,
  which renders `layer.label` straight from that prop) and `layer-colors.ts`'s `LAYER_LABELS` (read only by
  `LayerLegend`) remain two separate, manually-synchronized string sets — this fix aligned their current
  values, but nothing prevents them from drifting apart again if either one is edited alone in the future.
- **Verified live** against the running dev server with real, temporarily-inserted test data (a no-RSVP
  event, a section-wide event with three `TerminZusage` rows in each status, and a vehicle-booking event) —
  cleaned up afterward. Confirmed via rendered HTML/computed styles at 1280px: month-grouped cards with the
  correct per-layer left-border color, the "3 Termine · N offene Rückmeldungen" header line, the sidebar's
  Ebenen-card-with-footnote (no separate Legende card) plus the "Nur anzeigen" chips and Rückmeldungen
  swatch legend, and the vehicle-booking row showing only the "Fahrzeug" pill + "Buchung öffnen" (no RSVP
  UI at all). Confirmed via a direct DB write simulating a completed click (this session's browser-automation
  tooling has the same pre-existing, already-documented hydration gap noted throughout this file's other
  "Verification note" sections — `__reactFiber$`/`__reactContainer$` lookups found nothing attached, and even
  a pure client-state control with no server call, the `⌄` expand toggle, produced no visible change on
  click either, confirming this is the harness-wide gap and not specific to `setRsvp`): after inserting a
  `ZUGESAGT` row directly, reloading showed the row correctly collapsed to a single "Zugesagt" pill in place
  of both buttons, its RSVP chip counts incremented, and both the sidebar's "Offen" chip and the header
  subline correctly decremented by one — confirming the optimistic-update code path's *end state* renders
  correctly, though the click interaction and the live optimistic-then-settle transition itself could not be
  exercised directly in this session. The status-filter chips and the expand/collapse toggle's actual click
  behavior are code-reviewed (matching `HomeTodoList`'s already-proven-live pattern) but likewise not
  click-tested here, for the same reason. Tablet (768px) and mobile (390px) were confirmed unchanged both by
  live computed-style checks (correct table/card wrapper `display` at each width) and by diffing this pass's
  three touched files against the pre-pass commit, showing the tablet/mobile code paths received zero edits
  beyond the `LAYER_LABELS` string change above.

### Shared: Mobile header context (Titel-Collapse, Filter-Slot, Bottom Sheet)

Mobile-Brief.md needed two things a page deep inside `<main>` can't otherwise reach: pushing a page-specific
action icon into the shared mobile header bar, and crossfading that bar's wordmark with a large,
scroll-collapsing page title. `(app)/layout.tsx` wraps its whole return value (header **and** `<main>`) in
`<MobileHeaderProvider>` (`components/layout/mobile-header-context.tsx`) — a React Context, not a DOM portal:
the title crossfade needs a live 0–1 scroll-progress *value* shared between the header (wordmark) and the
page (large title), which a portal alone (JSX placement only, no shared reactive state) can't give you. The
header reads `title`/`titleProgress`/`actionSlot` via two tiny client components,
`mobile-header-title-slot.tsx` and `mobile-header-action-slot.tsx`, both hard-`sm:hidden` regardless of what
they're given — desktop's always-visible layout never needs either.

- **`CollapsingPageTitle`** (`components/layout/collapsing-page-title.tsx`) renders the large `<h1>` (mobile
  `text-[28px] font-bold`, `sm:text-lg sm:font-semibold` = the exact previous desktop style) plus a 1px
  sentinel right below it, watched by an `IntersectionObserver` with 21 thresholds (`0, .05, ..., 1`) and a
  `rootMargin` offset by the mobile header's own height (56px, `h-14`) so the crossfade threshold lines up
  with the bar's bottom edge. `intersectionRatio` drives a continuous `progress` (not a hard cut): the
  `<h1>` fades/shrinks via **imperative `ref.style` writes** (not React state) so the animation doesn't
  re-render on every threshold step, and `setTitle(title, progress)` mirrors the same value into context for
  the header's wordmark to crossfade against. Inline styles always beat the `sm:` CSS classes, so the effect
  explicitly clears them back to `''` (letting classes take over) whenever `matchMedia('(max-width: 639px)')`
  stops matching — otherwise a title faded out on mobile would still read `opacity:0` if the window were
  resized to desktop width live. Currently used only by Kalender's `<h1>`; other pages keep a plain
  non-collapsing title until they get their own mobile pass — the header just keeps showing the static
  "AFKDO Purkersdorf" wordmark on those pages, since nothing ever calls `setTitle`.
- **`BottomSheet`** (`components/ui/bottom-sheet.tsx`) — this codebase's first bottom-sheet pattern, generic
  enough to reuse for a future non-Kalender filter/settings panel: fixed dark overlay, `rounded-t-2xl` panel
  sliding up from the bottom, grab handle, "Fertig" button. The slide-in is a plain CSS `@keyframes` in
  `globals.css` (`.sheet-slide-up`, `prefers-reduced-motion`-guarded) rather than a Tailwind transition,
  since the sheet is fully mounted/unmounted (conditional `if (!open) return null`) with no prior DOM state
  to transition *from* — only a `@keyframes` animation runs automatically on mount without one.
- **`MobileTabBar`** (`components/layout/mobile-tab-bar.tsx`) switched from `flex` + `flex-1`-per-item to
  `grid grid-cols-[repeat(var(--tab-count),1fr)]` with `--tab-count` set via inline `style` from
  `items.length`, and its icons went from 22px to 24px — makes the column count explicit rather than
  implicit in flex-grow behavior, per the brief's specific ask.
- **Header restructure** (`(app)/layout.tsx`): the header is one `flex` row on every width now (previously
  `flex-col sm:flex-row`, which is what produced two stacked rows below `sm:`); mobile-only and desktop-only
  children are separated with `sm:hidden`/`hidden sm:*` pairs on individual elements instead. "Abmelden" is
  no longer in the mobile row at all — `ProfileMenu` now takes a `logoutAction` prop (a Server Action passed
  down rather than importing the route-group path directly) and renders its own `sm:hidden` `<form>` at the
  bottom of the dropdown; desktop's separate header `<form>` stays `hidden sm:block` so it isn't duplicated
  there. `ProfileMenu`'s name-text trigger button is `hidden sm:inline-flex`; a new initials-circle avatar
  button (first letter of `name`, `sm:hidden`) replaces it below `sm:` to fit the single-row bar.

**RSVP ("Zusage")**: `TerminZusage` (`prisma/schema.prisma`) is one row per (eventId, userId) — a
`ZusageStatus` (ZUGESAGT/ABGESAGT/UNKLAR) plus an optional note (max 200 chars, validated in
`lib/validation/rsvp.schema.ts`), upserted on re-submit rather than kept as history. `lib/auth/permissions.ts`'s
`canViewEvent(user, event)` is the single source of truth for "may this user RSVP to / see this event" —
identical rule to the Kalenderübersicht query itself (own org OR section-wide, Drohnengruppe category
additionally gated on module access); keep both in sync if the visibility rule ever changes.
`src/app/(app)/kalender/[eventId]/page.tsx` is a new, separate "Detailansicht" route (distinct from
`.../bearbeiten`) reachable by anyone who can see the event, not just admins — it shows the read-only event
info, the `EventRsvpButtons` widget (three status buttons + note field, `withNote` prop toggles the note
UI on/off), and the full Teilnehmerliste with per-status counts. `EventListView`'s badge and the detail page's
counts both come from `prisma.terminZusage.groupBy` in `kalender/page.tsx`/the detail page respectively — no
separate "API route" for reading, since Server Components fetch this directly, consistent with the rest of
the app (no REST endpoints exist for any other authenticated feature). `setRsvp` (in
`kalender/[eventId]/rsvp-actions.ts`) is called directly from client code (not a `<form action>`) so both the
list view's instant single-click toggle (no note) and the detail page's explicit save (with note) share one
action; a quick toggle omits the `note` argument entirely (not empty string) so it never clobbers a
previously saved note — see the comment above `noteProvided` in that file before changing this.

The detail page's "Push-Benachrichtigung jetzt senden" button (`SendEventPushButton` +
`triggerEventPushNotification`) is gated on `canManageEventsFor(user, event.organizationId)` — the same
right as editing/deleting the event itself, so any Feuerwehr-admin can push for their own org's events, not
just the Abschnittskommando-Admin. This is a deliberate departure from `canManageNews` (News module,
Abschnittskommando-Admin only) — explicitly chosen for this feature despite the parallel. It reuses the News
module's `sendPushToSubscriptions` but resolves its own audience via
`resolveEventAudienceUserIds`/`sendEventPushNow` (`lib/push/`) rather than `NewsMessage`'s
ORGANIZATION/DROHNENGRUPPE audience types, since an event can be section-wide without any corresponding
`NewsMessage` row — it's a one-off send, not persisted, no `sentAt` tracking.

`components/calendar/event-form.tsx`: changing Start always carries its date onto Ende; Ende's *time* is only
auto-suggested (Start + 15 minutes) while Ende has no time of its own yet — once it has one (typed or
suggested), further Start edits only sync the date, never overwrite a chosen Ende time. Picking category
"Drohnengruppe" auto-checks "Abschnitt-weiter Termin" (still manually uncheckable) since Drohnengruppe
events are cross-org by nature.

The .ics subscription links live in their own "ICS Kalender Import" card in the layout described above (not
the page header) with a copy-to-clipboard button (`components/ui/copy-link-button.tsx`) next to each. There
are two: the per-organization feed (keyed by `Organization.icsToken`, Abschnitt-scoped like the Kalender
query itself) and a **legacy combined Abschnitts-feed** keyed by the single `ABSCHNITTS_ICS_TOKEN`
environment variable. That second one has no `Organization` row of its own to scope by, so it is pinned to
one Abschnitt by `nummer` via `LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER` (`lib/organizations/abschnitt.ts`,
`'17700'` = Purkersdorf) — both its query and its calendar title — and `kalender/page.tsx` only offers the
link to users whose own Abschnitt is that one. Don't "generalize" it back to all Abschnitte without giving
it a real per-Abschnitt token first; before this was pinned it served every Abschnitt's section-wide events
to everyone under a "Purkersdorf" label. Separately,
`src/app/(app)/kalender/[eventId]/ics/route.ts` serves a **single-event** .ics download (session-authenticated,
same organization/category visibility check as the main Kalender query) so a real file response — not a
`data:` URI — triggers the native "add to calendar" flow on mobile. `components/calendar/add-to-calendar-link.tsx`
links to it from wherever an event is actually visible: the list view (icon per row), the grid view's
event-detail popup (non-editable events only show up there), and the edit page (editable events navigate
straight there instead, so the popup never renders for them).

**Externer ICS-Kalenderimport (5-Minuten-Sync)** — the reverse direction of the .ics links above: a
Feuerwehr can point at an *external* read-only .ics feed (e.g. a Google Calendar "public/basic.ics" share
link) and have its events mirrored into that Feuerwehr's own Kalender automatically, requested so members
don't need to keep a separate external calendar in sync by hand.

- **Schema**: `Organization.icsImportUrl`/`icsImportLastSyncAt`/`icsImportLastSyncError` (all nullable, same
  per-org-settings shape as `atemschutzSachbearbeiterEmail`/`facebookPageId` - deliberately **not** masked
  in the admin form the way `facebookPageAccessToken` is, since a public .ics feed URL carries no secret).
  `Event.icsUid` (nullable, `@@unique([organizationId, icsUid])`) marks a synced event and protects it from
  manual editing/deletion - the exact same "mere presence of a foreign flag blocks edit/delete" pattern
  `vehicleBookingId` already established: `kalender/actions.ts`'s `updateEvent`/`deleteEvent` and
  `kalender/[eventId]/bearbeiten/page.tsx` each got an added `!existing.icsUid` check alongside their
  existing `!existing.vehicleBookingId` one, and `kalender/page.tsx`'s `editable` flag (which the list
  view's double-click-to-edit shortcut and the grid's `eventClick` handler both already key off) gained the
  same `&& !event.icsUid`. **Deliberately different from vehicle-booking events**: RSVP ("Zusage") and the
  Teilnehmerliste are left fully visible/functional on synced events (only `kalender/[eventId]/page.tsx`'s
  "Bearbeiten" link gets the extra `!event.icsUid` check) - a real Feuerwehr activity imported from a
  calendar (Übung, Kameradschaftsabend, Einsatz) has a genuine RSVP concept, unlike a vehicle booking, so
  there was no reason to hide it here the way V4 deliberately did for bookings.
- **`src/lib/calendar/ics-import.ts`**'s `syncIcsCalendarForOrganization(organizationId, icsUrl)` is the
  whole sync: fetch the feed, parse with `node-ical` (new dependency - the first ICS *parsing* library in
  this codebase; `ical-generator` is output-only, used solely for the app's own outgoing .ics feeds above),
  then a full reconcile within a rolling **sync window** (`now − 14 days` to `now + 12 months` - a deliberate
  bound, not "import the whole feed": the real Google Calendar this was built against has ~800 events
  stretching back to 2017, and a rolling window keeps each 5-minute sync fast and avoids flooding the
  calendar grid with a decade of history) against `Event` rows scoped to `organizationId` with `icsUid` set:
  new source events are created, existing ones (matched by `icsUid`) updated in place, and previously-synced
  events whose `icsUid` no longer appears in the current feed are deleted (their `TerminZusage` rows cascade
  automatically, same `onDelete: Cascade` already used everywhere else RSVPs are tied to an `Event`).
  **RRULE-recurring events are supported but were never exercised by the real feed this was built
  against** (confirmed live: 802 real VEVENTs, zero using `RRULE`/`EXDATE`/`RECURRENCE-ID` - every
  occurrence in that calendar is already its own standalone VEVENT) - `node-ical`'s own
  `expandRecurringEvent(event, {from, to})` helper (which handles `RECURRENCE-ID` overrides and `EXDATE`
  exclusions internally, not hand-rolled here) is still called for any VEVENT that does carry an `rrule`,
  with each expanded occurrence given its own deterministic `icsUid` (`${baseUid}::${occurrenceStartISO}`) so
  a whole recurring series doesn't collapse onto one `organizationId`+`icsUid` row. `ParameterValue` fields
  (`summary`/`description`/`location`) from `node-ical` come back as either a plain string or `{val,
  params}`, per the library's own documented pattern - `textValue()` here follows that exact safe-access
  pattern rather than assuming a shape. `Event.createdById` is a required FK, so imported events are
  attributed to a lazily-created system user (`src/lib/calendar/ics-sync-user.ts`, `isActive: false`,
  `kalender-ics-sync@system.local`) - the same precedent as the Drohnengruppe QR-Schnellerfassung's system
  user (`src/lib/drone/quick-register-user.ts`), not a new pattern.
- **Admin UI** (`/admin/heimatfeuerwehr`, new "Kalender-Import (ICS)" section, own card matching this page's
  established single-page-multi-section shape): `ics-import-form.tsx` + `setIcsImportUrl`/
  `triggerIcsImportNow` in that page's `actions.ts`, `canManageHeimatfeuerwehrFor`-gated like every other
  action there. Changing the URL resets `icsImportLastSyncAt`/`icsImportLastSyncError` to null (an old
  success/failure timestamp from a *previous* source URL would otherwise read as current status for the new
  one). "Jetzt synchronisieren" calls `triggerIcsImportNow`, which runs the exact same
  `syncIcsCalendarForOrganization` the cron route uses - the same "manual trigger reuses the real
  production function, not a special-cased test path" precedent as `/admin/status`'s "System Check" button
  reusing `notifySystemCheckResult()`.
- **Cron**: `/api/cron/kalender-ics-sync` (new route, `CRON_SECRET`-gated exactly like the other `/api/cron/*`
  routes, already covered by `middleware.ts`'s public-prefix list) loops every `Organization` with
  `icsImportUrl` set, one `try`/`catch` per org (a broken feed for one Feuerwehr must not block the others -
  same `continue`-on-error shape as `fetchAndCacheFacebookPosts`'s loop), always recording
  `icsImportLastSyncAt`/`icsImportLastSyncError` (success or failure) so the admin page never shows a stale
  success timestamp after a feed starts failing. `docker/kalender-ics-sync.sh` mirrors
  `docker/facebook-fetch.sh`'s exact host-wrapper shape, tracked executable in git
  (`git update-index --chmod=+x`, the same real-incident lesson from `backup.sh`/`send-scheduled-news.sh`
  being committed non-executable, see System Check above) - crontab entry documented in
  `docker/README.md`, **every 5 minutes** (`*/5 * * * *`) as requested, not hourly/daily like this app's
  other cron jobs.
- **Verified end-to-end against the real, live Google Calendar feed this was built for** (not just
  type-checked): a standalone script run directly against `syncIcsCalendarForOrganization` (the dev-server
  process itself can't make outbound HTTPS fetches in this sandboxed environment - the same pre-existing,
  already-documented local TLS/proxy limitation as the WASTL proxy above, confirmed again here via the
  identical "fetch failed / unable to get local issuer certificate" - but a script run through the Bash
  tool's own shell fetches the same URL fine) confirmed: first sync imports 41 events (all real events
  falling inside the 14-day/12-month window, including correct multi-line `location` text), an immediate
  second sync updates all 41 and creates zero duplicates (confirming `icsUid`-based matching works, not
  re-importing every run), and a manually-inserted fake "stale" `Event` with a `icsUid` absent from the real
  feed is correctly deleted on the next sync. Also verified live in the browser: an `icsUid`-tagged event's
  edit page shows the blocking message instead of the form, while its detail page still shows a fully
  working "Meine Zusage"/Teilnehmerliste.
- **Bugfix (real production error, seen in the admin UI's "Letzter Sync fehlgeschlagen": "Invalid
  `prisma.event.create()` invocation: Unique constraint failed on the fields: (`organizationId`,
  `icsUid`)")**: the dedupe lookup that decides update-vs-create scoped its `existing` query to
  `startsAt: { gte: windowStart, lte: windowEnd }` - the same window used to decide what to import in
  the first place. If a source event's date changes (rescheduled, corrected) such that its
  *previously stored* `startsAt` now falls outside the current sync window while its *new* `startsAt`
  falls back inside it, that DB row silently drops out of `existingByUid`, and the next sync tries to
  `create()` a second row with the same `icsUid` - violating the `(organizationId, icsUid)` unique
  constraint the DB enforces (there is no `startsAt` in that constraint, only `icsUid`). Fixed by
  querying `existing` without any `startsAt` filter at all (so the update-vs-create dedupe always sees
  every `icsUid` row for the org, however far its stored date has drifted) and moving the window check
  to where it actually belongs: deciding which *disappeared-from-the-feed* rows count as "stale" and
  get deleted, using each row's own pre-sync `startsAt` captured in that same query. Verified directly
  (not just read for correctness): a standalone script stubbed `global.fetch` to serve a synthetic
  one-VEVENT feed, pre-inserted an `Event` with a matching `icsUid` but a `startsAt` 20 days in the
  past (outside the window), and confirmed the sync now resolves to `updated: 1, imported: 0` with
  exactly one row for that `icsUid` afterward - reproducing the exact reported scenario and confirming
  the fix, whereas the old scoped query would have missed the row and hit the unique-constraint error.
- **Pre-existing, separately flagged issue (found while investigating the bug above, not fixed in this
  round)**: two committed migrations - `20260804090000_vehicle_booking_details` and
  `20260804110000_vehicle_booking_approval` - `ALTER TABLE "VehicleBooking"`, but are timestamped
  *before* `20260811090000_meine_feuerwehr`, the migration that actually `CREATE TABLE`s
  `VehicleBooking`. This doesn't affect the already-migrated dev/production databases (their
  `_prisma_migrations` history was populated in the real, correct order those migrations were actually
  run in, regardless of what their folder names suggest), but it does break any from-scratch replay -
  confirmed live via `prisma migrate dev`'s shadow-database step failing with `P1014: The underlying
  table for model VehicleBooking does not exist`. Deliberately **not fixed** here: correcting it means
  renaming already-deployed migration folders, which would require a matching, carefully-coordinated
  `UPDATE "_prisma_migrations" SET migration_name = ...` against production's database at deploy time
  (the same remedy this codebase's history already documents doing successfully twice before for the
  same class of bug, see the `Organization.nummer`/`atemschutzSachbearbeiterEmail` migrations above) -
  too risky to bundle into an unrelated bugfix without that coordination. Whoever picks this up next
  should rename both folders to sort after `meine_feuerwehr` and fix production's tracking table in the
  same change, not treat it as a pure local-repo rename.

**Google-Kalender-Rückschreiben** — the reverse direction of the ICS import above: app-177-originated
events (`icsUid: null`) are pushed into a Google Calendar per Feuerwehr, configured via an uploaded
Service-Account JSON + a target calendar ID, instead of a periodic cron. Full design rationale in
`docs/superpowers/specs/2026-08-04-google-calendar-push-sync-design.md`.

- **Additive schema**: `Organization.googleCalendarServiceAccountJson`/`googleCalendarId`/
  `googleCalendarLastSyncAt`/`googleCalendarLastSyncError` + `Event.googleEventId`. The JSON field is a
  real secret, treated exactly like `facebookPageAccessToken` - plain `String?`, never selected/passed
  into a client-component prop, only a derived `hasCredentials: boolean` reaches the UI.
- **`src/lib/calendar/google-calendar-push.ts`** (new) is the whole write side, built on
  `google-auth-library`'s `JWT` client (not the full `googleapis` package - only RS256 JWT-signing is
  genuine cryptography worth pulling in a library for, the same reasoning that already justified
  `@aws-sdk/client-s3` as this codebase's one other SDK dependency instead of hand-rolling AWS SigV4).
  `pushEventToGoogleCalendar(event)`/`deleteEventFromGoogleCalendar(event)` **never throw** - both
  catch their own errors, log them, and write the result into
  `Organization.googleCalendarLastSyncAt`/`googleCalendarLastSyncError`, so every call site can just
  `await` them with no try/catch of its own (same "external side effect must never block the core
  action" principle as `notifyFlightCreated`). **Schleifen-Schutz**: both no-op immediately if
  `event.icsUid` is set - an event that came FROM a Google import is never written back, regardless of
  whether the import and push calendars are the same one.
- **Sofort, nicht periodisch**: no cron job for this direction. Six call sites push/delete directly
  inside the existing Server Actions right after the corresponding Prisma write - `createEvent`/
  `updateEvent`/`deleteEvent` (`kalender/actions.ts`), `createVehicleBooking`'s immediate-`GENEHMIGT`
  branch and `cancelVehicleBooking` (`meine-feuerwehr/actions.ts`), and `decideVehicleBooking`'s
  `GENEHMIGT` branch (`lib/heimatfeuerwehr/vehicle-booking-decision.ts`) - the last two mean a Fahrzeug-
  Reservierung is pushed the moment it's approved, whichever of the two approval paths (immediate or
  freigabe-pflichtig) produced that approval, with no special-case code needed since both already only
  ever create the linked `Event` at exactly that point. A cron-based batch diff can't detect deletions
  (a hard-deleted row leaves nothing to compare against), so once delete needs a direct hook anyway, create/
  update get the same direct-hook treatment for consistency rather than splitting the write path across
  two different mechanisms.
- **Feldabbildung**: `title`→`summary`, `description`→`description`, `location`→`location`;
  timed events send `dateTime` (no offset) + `timeZone: 'Europe/Vienna'` explicitly rather than a UTC
  offset, computed via `Intl.DateTimeFormat` reading the Vienna wall-clock components directly - robust
  regardless of the host process's own default timezone (unlike the Docker container, this repo's local
  dev machine has no `TZ` pinning at all), avoiding the same class of DST bug already documented for
  this app's stored-datetime handling. All-day events send `date` only - Google's `end.date` is
  **exclusive** (the day after), unlike app-177's inclusive `endsAt`, so writing one adds a day via
  UTC-noon-anchored date arithmetic (noon is never near a DST transition, so the +1 is never
  accidentally off by an hour's worth of calendar date).
- **Admin UI** (`/admin/heimatfeuerwehr`, new "Google Kalender (Rückschreiben)" card right after the
  ICS-Import card): a JSON file upload + calendar-ID text field, explicit hint text "Nur für Google
  Kalender möglich" per the app owner's exact wording, "Hinterlegt: Ja/Nein" status (never the secret
  itself) + last-sync timestamp/error (same pattern as the ICS import card), "Entfernen" button. The
  upload Server Action (`setGoogleCalendarCredentials`) calls a real Google token exchange
  (`verifyServiceAccountCredentials`, i.e. `JWT.authorize()`) **before** saving anything, rejecting a
  malformed/wrong-project key with Google's own error message instead of silently storing a broken
  credential - same "test the real path once, don't just validate shape" precedent as the ICS import's
  "Jetzt synchronisieren" button and `/admin/status`'s System Check.
- **Verified end-to-end against the real Google Calendar this was built for** (not just type-checked or
  mocked): a standalone script temporarily set a real Feuerwehr's Google-Calendar fields to the app
  owner's actual service-account credentials and calendar id (the same one already used for the ICS
  import - confirming the loop-protection design choice was necessary, not theoretical), inside a
  try/finally that always restores the row afterward. Confirmed: a timed test event round-tripped
  through create → visible via a live Google API read-back with the correct summary and the correct
  Vienna-local `dateTime`/offset → update (`PATCH`, not a second `POST`) → delete (confirmed gone via a
  second live read-back); an all-day test event's `end.date` came back exactly one day after
  `start.date` as Google's own API reported it; and a third event created with `icsUid` set was
  confirmed to receive **no** `googleEventId` at all - the loop-protection guard never even attempts a
  network call for it. One real setup gap was hit and resolved during this verification: the Google
  Cloud project had the Calendar API disabled by default (`Google Calendar API has not been used in
  project ... or it is disabled`, a 403) until the app owner enabled it in the Cloud Console - documented
  here since it's a one-time setup step, not a bug in this code.
- **Bugfix (real production report: a Fahrzeug-Reservierung's calendar entry showed RSVP buttons, and
  the same reservation appeared TWICE in the Kalender list)**: the write side's loop-protection
  (`pushEventToGoogleCalendar` skipping anything with `icsUid` set) only defends against re-pushing an
  *imported* event back to Google - it never anticipated the opposite direction. Wolfsgraben has
  `icsImportUrl` and `googleCalendarId` pointing at the **same** Google Calendar (by the app owner's own
  design - see the Context section above). The moment app-177 pushes its own event to that calendar, the
  next 5-minute ICS-import sync reads it straight back - and since the import side only recognizes
  previously-imported rows by `icsUid`, which has nothing to do with `googleEventId`, it saw an
  unrecognized "new" VEVENT and created a **second, phantom `Event` row** for it (`icsUid` set,
  `vehicleBookingId` never set, since it's not the row the vehicle-booking code created). That phantom row
  passed every existing RSVP guard fine on its own terms - `!event.vehicleBookingId` is true for it - which
  is exactly why RSVP appeared "for the automatically created appointment": there were two rows, one
  correctly protected and one not. **Root cause fully confirmed, not guessed**: a standalone script pushed
  a real test event and confirmed empirically that Google's ICS feed exports that event's `UID` as
  exactly `{googleEventId}@google.com` (Google's own `iCalUID` field in the create response literally
  spells this out) - a deterministic relationship, not a coincidence to work around loosely. Fixed in
  `syncIcsCalendarForOrganization` (`ics-import.ts`): before importing, it now also loads that org's own
  `Event` rows with `googleEventId` set (`icsUid: null`), builds the set of `{googleEventId}@google.com`
  UIDs they'd appear as in the feed, and skips any incoming VEVENT whose UID is in that set entirely -
  not counted as "seen" either, so a phantom row already sitting in the DB from *before* this fix gets
  correctly recognized as orphaned and deleted by the existing stale-row cleanup on the very next sync,
  with no manual database cleanup needed. This is the general fix for the whole read/write loop, not a
  vehicle-booking-specific patch - it protects any app-177-native event (Kalender, Fahrzeug-Reservierung,
  anything with a `googleEventId`) from ever being duplicated back in by its own organization's import.
  Verified end-to-end against the real Google Calendar and a real Postgres row set (not mocked): pushed a
  native test event, manually inserted a phantom duplicate row exactly like the bug would have produced,
  ran the real `syncIcsCalendarForOrganization`, and confirmed all three outcomes - the pre-existing
  phantom was deleted as stale, no new phantom was created for the freshly-pushed event, and the native
  event itself was left untouched. Separately, `setRsvp` (`kalender/[eventId]/rsvp-actions.ts`) also
  gained its own `!event.vehicleBookingId` guard during this investigation - it was the only Event-related
  write action without one (`updateEvent`/`deleteEvent` already had it), a real defense-in-depth gap even
  though no current UI path reaches it for such an event.

`components/ui/datetime-15min-input.tsx` (a plain `<input type="date">` + a `<select>` whose only options
are `:00`/`:15`/`:30`/`:45`) is used via react-hook-form's `Controller` everywhere a time needs to snap to
15-minute steps: `event-form.tsx` (Kalender), `components/drone/flight-form.tsx` and the QR quick-register
form, and `components/news/news-form.tsx`. Don't go back to `<input type="datetime-local" step={900}>` for
this — it was tried first and doesn't work: Chrome/Edge's native picker only enforces `step` as a *validity*
constraint, the minute dropdown in the picker UI still lists every single minute, so users could (and did)
pick e.g. `:12`. The date+select combo makes off-step minutes impossible to select at all, not just invalid.

