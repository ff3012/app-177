# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A member-facing web app for the Freiwillige Feuerwehr Abschnitt Purkersdorf (Austria): 9 Feuerwehren + 1
Abschnittsfeuerwehrkommando (AFKDO), ~200 users. Three modules: **Kalender** (per-org + Abschnitt-wide event
calendar with .ics export, calendar-grid or list view), **Drohnengruppe** (drone flight log, including a
QR-code quick-registration flow — see below), and **News** (Web Push notifications to a Feuerwehr or the
Drohnengruppe, sent immediately or scheduled — see below). Installable as a PWA (manifest + minimal service
worker) so it can be added to an iOS/Android home screen without an app-store build. All UI copy and
commit-adjacent docs are German; code identifiers are a German/English mix (keep matching the existing
convention in a given file).

## Commands

```bash
npm run dev            # local dev server
npm run build           # production build
npm run lint             # next lint

npm run db:migrate      # prisma migrate dev (local) — generates a new migration from schema.prisma changes
npm run db:deploy       # prisma migrate deploy — applies committed migrations (used in prod, see entrypoint.sh)
npm run db:seed         # tsx prisma/seed.ts — creates the 9 Feuerwehren, AFKDO org, Drohnen lookups, bootstrap admin
npm run db:studio       # prisma studio
```

There is no test suite in this repo.

Local Postgres for dev: `docker compose -f docker-compose.dev.yml up -d` (exposes `localhost:5432`), then copy
`.env.example` to `.env` before the commands above.

### Deployment (Hetzner + Docker Compose + Caddy)

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d --build
```

`docker/entrypoint.sh` runs `prisma migrate deploy` automatically on container start before `node server.js` —
migrations never need to be triggered manually in production. See `docker/README.md` for full setup
(env vars, Caddy domain, Mailjet sender verification, backups via `docker/backup.sh`).

`prisma` and `tsx` are regular `dependencies` (not devDependencies) — the production image needs both at
runtime (`migrate deploy` and one-off `db seed` calls against the running container), and the Docker build
copies the **full** `node_modules` into the runner stage rather than cherry-picking subfolders, because
`@prisma/config`'s transitive deps (e.g. `effect`) broke when only `prisma`/`@prisma` were copied.

`docker/docker-compose.yml` lists the `app` service's environment variables **explicitly** (not
`env_file: .env`) — adding a new variable to `.env`/`.env.example` alone does nothing; it must also be added
to that `environment:` block or the container never sees it. This has already bitten this project **twice**:
first the News module's `VAPID_*`/`CRON_SECRET` vars, then again with `S3_BACKUP_BUCKET`/`S3_ENDPOINT_URL`/
`S3_ACCESS_KEY`/`S3_SECRET_KEY` — set in production `.env` and working fine for `docker/backup.sh` (a host
cron script that reads `.env` directly, outside the container), but absent from this `environment:` block,
so `checkS3Connection()` inside the app container always saw `process.env.S3_BACKUP_BUCKET` as `undefined`
and reported "S3 Exoscale Verbindung: FEHLER" in the daily System Check email even though the actual S3
upload in `backup.sh` was succeeding every night ("Letztes S3-Backup: OK" right next to it) — a strong tell
for this exact failure mode: one check that reads env vars via the app container disagreeing with another
check fed by a script that reads `.env` directly. Now fixed by adding all four to this block; **any future
env var read by application code (as opposed to only by a host-side script like `backup.sh`/
`send-scheduled-news.sh`) must be added here too, not just to `.env`/`.env.example`.**

The `app` container's `TZ` is pinned to `Europe/Vienna` in `docker-compose.yml`, and the runner image
installs `tzdata` (Alpine doesn't ship the IANA timezone database by default, so `TZ` would otherwise be
silently ignored). This matters because every date/time form (Kalender, Flug registrieren, News) submits a
plain `"YYYY-MM-DDTHH:mm"` string with no UTC offset; `new Date(...)` parsing that string in a Server Action
resolves it using the *executing process's* local timezone. Without the pinned `TZ`, that's the server OS
(UTC), silently shifting every stored time by Vienna's UTC offset (1–2h depending on DST) — this was a real
production bug, caught only after the News module's scheduled-send feature made the mistiming obvious. Don't
remove or "simplify" the `TZ` env var or the `tzdata` install.

## Architecture

**Stack**: Next.js App Router (TypeScript) · PostgreSQL via Prisma · Auth.js v5 (beta) with the Credentials
provider, JWT sessions · Tailwind · `react-hook-form` + `zod` for all forms · `exceljs` for XLSX export ·
`ical-generator` for .ics · Mailjet REST API directly via `fetch` (no SDK) for transactional email ·
`@aws-sdk/client-s3` for the System Check's live S3/Exoscale connectivity probe (the one SDK dependency in
the codebase, see "System Check" below for why).

### Route groups

- `src/app/(auth)/*` — public pages: `/login`, `/passwort-vergessen`, `/passwort-zuruecksetzen/[token]`,
  `/aktivieren/[token]`. Listed explicitly in `src/middleware.ts`'s `PUBLIC_PATH_PREFIXES`.
- `src/app/(app)/*` — everything else. `src/app/(app)/layout.tsx` calls `requireUser()` for every page in
  this group, so individual pages don't need their own "am I logged in" check — but they still need their
  own **authorization** check (see Permissions below), since the layout only proves you're logged in, not
  that you're allowed to see that particular page/action.
- `src/app/drohnen-schnell/[token]/*` — a **third**, top-level route outside both groups, on purpose: it's a
  fully public, session-less page (see QR quick-registration below) and must render with neither the
  `(app)` header/nav chrome nor its `requireUser()` gate. Nesting it under `(app)/drohnen/...` would have
  inherited that gate since layouts apply by directory nesting, not by URL. Follow the same pattern (new
  top-level segment + `PUBLIC_PATH_PREFIXES` entry) for any future no-login, capability-URL page.
- `src/middleware.ts` runs on the **Node.js runtime** (`export const config = { runtime: 'nodejs' }`), not
  the default Edge runtime — required because its `auth()` call triggers the same DB-backed permission
  refresh as everywhere else (see Session model below), and Prisma cannot run on Edge. Don't move this back
  to Edge without re-solving that.

### Session / permission model (`src/lib/auth/`)

- `auth.config.ts` is the single Auth.js instance used everywhere (middleware, Server Components, Server
  Actions, the `/api/auth/[...nextauth]` route). There used to be a second, Edge-safe instance just for
  middleware; it caused session-cookie validation mismatches and was removed in favor of Node runtime
  middleware — don't reintroduce a second instance.
- The `jwt()` callback does more than pass through claims: on every request that *isn't* a fresh sign-in, it
  re-fetches the user from the DB and rebuilds the claims (role/org/Drohnengruppe membership can change while
  a session is live — e.g. an admin revokes Drohnengruppe access — and this makes that change apply on the
  user's very next request instead of only at their next login). If the user no longer exists or was
  deactivated, `token.id` is cleared, which `getOptionalUser()` treats as logged-out.
- `build-session-user.ts` computes the `SessionUser` claims object (`isAbschnittsAdmin`,
  `feuerwehrAdminOrgIds`, `isDrohnengruppeMember`, `droneGroupRole`, etc.) from a `User` + relations. This is
  the *only* place that shape gets built — both the login path and the per-request refresh path call it.
- `lib/auth/permissions.ts` holds plain, composable predicate functions (`canManageEventsFor`,
  `canViewDroneModule`, `canManageFlight`, ...) — there is no RBAC library and no middleware-level
  fine-grained authorization; every Server Action/page re-checks permissions itself using these functions.
  When adding a new capability, add a function here rather than inlining a condition at the call site.
- `isSiteAdmin` (Abschnittskommando-Admin) and `isDroneGroupAdmin` (Admin Drohnengruppe) are **independent**
  rights. Site admin does not imply Drohnengruppe access, by design — see the comment above
  `canViewDroneModule` for the reasoning if you're tempted to "simplify" this.
- Login rate limiting (`lib/auth/login-throttle.ts`) tracks failures against the `LoginAttempt` table keyed
  by the *submitted* email string, regardless of whether it matches a real account — this is intentional so
  that whether an email gets rate-limited doesn't itself leak account existence. `authorize()` in
  `auth.config.ts` also always runs a real bcrypt compare (against a cached dummy hash when no user matches)
  for the same reason — timing-safe against user enumeration.
- One-time tokens (account activation, password reset) live in `PasswordToken`, created/consumed via
  `lib/auth/tokens.ts`. The DB only ever stores a SHA-256 hash of the token; the raw token exists only in the
  emailed link. Activation and password-reset both end by calling `signIn()` directly to auto-authenticate —
  see `isAuthError`/`isNextRedirectError` in `lib/auth/is-auth-error.ts` for how success (throws a
  `NEXT_REDIRECT`) is told apart from failure (throws an `AuthError`) when wrapping `signIn()`. The
  `instanceof AuthError` check alone isn't reliable because Next.js can bundle a Server Action's code into a
  different chunk than the one that threw, so both files fall back to duck-typing on `.name`/`.type`/`.digest`.
- **Email-token login**: `/login` lets a member choose Passwort or E-Mail Token via a tab toggle in
  `login-form.tsx`. The token path is a *second, separate* Auth.js Credentials provider
  (`id: 'email-token'` in `auth.config.ts`) rather than a branch inside the password provider, so the two
  stay cleanly separated. This provider itself accepts *two different* credential shapes for what's
  conceptually one login grant: `{ token }` (the long link) or `{ email, shortCode }` (the short code) —
  handled as two branches inside one `authorize()`, not a third provider, since both ultimately consume the
  same `PasswordToken` row. Requesting one (`requestLoginToken` in `login/actions.ts`) reuses the exact
  non-enumerating response and dual rate-limit pattern (per-browser cookie + per-account recent-token check)
  already established by `passwort-vergessen/actions.ts` — a nonexistent/inactive email gets the *same*
  generic "falls ein Konto existiert..." message as a real one. `TokenPurpose.LOGIN` reuses the shared
  `PasswordToken` table (5-minute TTL, shortest of the three purposes — see `TTL_BY_PURPOSE` in
  `tokens.ts`); `createLoginToken` additionally generates a 6-digit `shortCode` (hashed at rest, same as the
  token) stored on that same row, so consuming either one invalidates both.

  **Token-request throttle** (`LoginTokenRequestAttempt`, `login-throttle.ts`): a *separate* table/counter
  from `LoginAttempt` — it counts token-*issuance* events (a link+code actually emailed), not failed login
  attempts, so it can't just reuse `LoginAttempt`'s counter. `checkLoginTokenThrottle`/
  `recordLoginTokenRequest`/`resetLoginTokenThrottle` mirror `checkLoginThrottle`/`recordFailedLogin`/
  `resetLoginAttempts` exactly, including the atomic `increment` update (no lost-update race under concurrent
  requests) and keying by the raw submitted email regardless of account existence. Limit: 3 issued
  tokens per 5-minute window, then a 15-minute lockout. `requestLoginToken` checks
  `checkLoginTokenThrottle` first, then calls `recordLoginTokenRequest` only inside the `if (!recentToken)`
  branch where a token is actually created — the existing 30-second cookie/DB dedupe (re-clicking the button
  without waiting) does *not* itself count against the 3-per-5-min budget, only real issuances do.
  `confirmLoginWithToken` calls `resetLoginTokenThrottle` alongside `resetLoginAttempts` on success; the
  link-click path (`login/token/[token]/actions.ts`) does not, since it would need an extra user lookup to
  get the email — an accepted minor gap, not a bug to "fix" reflexively.

  **Why two forms of the same token exist — a real iOS constraint, confirmed by testing, not just theory**:
  an email link opened from Mail always lands in a regular Safari tab, never directly inside an
  already-installed "Zum Home-Bildschirm" PWA, because iOS gives standalone web apps their own storage
  container, genuinely separate from Safari. This isn't just a stale in-memory session either — confirmed
  that even a full close (swipe away in the app switcher) and relaunch of the home-screen app does *not*
  pick up a session established via the emailed link in Safari. There is no way to share a cookie across
  that boundary; it's a hard platform limitation, not something fixable in this codebase. The long token
  still powers `/login/token/[token]` (one explicit "Jetzt anmelden" click, not auto-consumed on page load,
  so an email link-scanner's automatic GET can't burn it before the real user clicks — same reasoning as why
  activation/password-reset are also form-submission-gated) for anyone in a normal browser tab. But for a
  home-screen-PWA user, the *only* way to end up logged in inside that PWA's own container is to never leave
  it — hence the always-visible "Code aus E-Mail einfügen" section in `login-form.tsx`'s E-Mail-Token tab,
  wired to `confirmLoginWithToken`, which calls `signIn('email-token', { email, shortCode })` directly from
  whatever context `/login` is currently running in. A 6-digit code is guessable by brute force where the
  long token isn't, so `confirmLoginWithToken` requires the email too and runs through the exact same
  `login-throttle.ts` rate limiting as password login (5 attempts per email, then a 15-minute lockout) —
  don't drop that check when touching this code. `sendLoginTokenEmail` shows the short code as a large
  copyable block and the link separately; this whole iOS storage-isolation limitation applies equally to
  activation/password-reset links, it's just far more commonly hit for login. `/login/token/erfolgreich`
  (redirected to after a successful *link* login, not the code path) shows an iOS-specific note about this
  too, detected via the `user-agent` request header.

### Data model (`prisma/schema.prisma`)

- `Organization` is one table for both Feuerwehren and the Abschnittskommando (`type` enum), not two tables —
  keeps every FK (`Membership`, `Event.organizationId`) pointing at a single target.
- `Membership` (user, org, role=ADMIN) is per-org admin rights. `DrohnengruppeMembership` (role
  PILOT/ADMIN) is a separate, flat, cross-org table — Drohnengruppe membership has nothing to do with which
  Feuerwehr someone belongs to.
- `Event.isSectionWide` + `Event.category` (ALLGEMEIN/DROHNENGRUPPE) together determine visibility:
  Drohnengruppe-category events are filtered out for anyone who fails `canViewDroneModule`, on both the
  Kalender page and the `.ics` feeds (the feeds are token-authenticated, not session-authenticated, so they
  can't check membership — they exclude the Drohnengruppe category entirely instead of trying).
- `DroneFlight` has two separate `User` relations: `registeredBy` (who logged the entry — controls edit
  rights) and `pilotUser` (who actually flew — a dropdown of current Drohnengruppe members in the form, not
  free text). Don't conflate the two; "can I edit this flight" is based on `registeredBy`, not `pilotUser`.
- `AppSettings` is a singleton table (always exactly one row, `id = "singleton"`, upserted — never
  `create`d directly) for admin-configurable values that don't warrant their own table:
  `droneFlightNotificationEmail` and `droneQuickRegisterToken`. Read/write it only through
  `src/lib/settings.ts`, not raw Prisma calls at the call site.
- `PushSubscription` (one row per browser/device, keyed by that browser's own `endpoint`) and `NewsMessage`
  (`audienceType` ORGANIZATION/DROHNENGRUPPE + optional `audienceOrgId`, `scheduledAt`/`sentAt`) back the
  News module — see below.
- Migrations are committed SQL under `prisma/migrations/`, applied automatically by
  `docker/entrypoint.sh` via `prisma migrate deploy` on every container start. Generate new ones with
  `npm run db:migrate` after editing `schema.prisma`; don't hand-edit already-committed migration files.

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
the page header) with a copy-to-clipboard button (`components/ui/copy-link-button.tsx`) next to each. Separately,
`src/app/(app)/kalender/[eventId]/ics/route.ts` serves a **single-event** .ics download (session-authenticated,
same organization/category visibility check as the main Kalender query) so a real file response — not a
`data:` URI — triggers the native "add to calendar" flow on mobile. `components/calendar/add-to-calendar-link.tsx`
links to it from wherever an event is actually visible: the list view (icon per row), the grid view's
event-detail popup (non-editable events only show up there), and the edit page (editable events navigate
straight there instead, so the popup never renders for them).

### Shared: 15-minute time picker

`components/ui/datetime-15min-input.tsx` (a plain `<input type="date">` + a `<select>` whose only options
are `:00`/`:15`/`:30`/`:45`) is used via react-hook-form's `Controller` everywhere a time needs to snap to
15-minute steps: `event-form.tsx` (Kalender), `components/drone/flight-form.tsx` and the QR quick-register
form, and `components/news/news-form.tsx`. Don't go back to `<input type="datetime-local" step={900}>` for
this — it was tried first and doesn't work: Chrome/Edge's native picker only enforces `step` as a *validity*
constraint, the minute dropdown in the picker UI still lists every single minute, so users could (and did)
pick e.g. `:12`. The date+select combo makes off-step minutes impossible to select at all, not just invalid.

### Drohnengruppe module

Visibility of the whole module and of *all* flights (vs. just your own + ones you piloted) are separate
checks — `canViewDroneModule` (module visibility) vs. `canViewAllFlights` (row-level scope, Admin
Drohnengruppe only). `src/lib/drone/members.ts` (`listDrohnengruppeMembers`) is the shared query for
"who can be picked as a pilot" — reused by the flight form, the 90-day report, and nowhere else; keep it that
way rather than duplicating the `where: { droneMembership: { isNot: null } }` filter.

`/drohnen`'s "Alle Flüge einsehen" toggle (`components/drone/flight-table.tsx`, default on) is purely a
client-side display filter, not a permission boundary: the server query in `page.tsx` already fetches every
flight whenever `canViewAllFlights(user)` is true, and the toggle just filters that already-loaded array down
to the current user's own registered/piloted flights when switched off. Only rendered at all when
`canToggle` (= `canViewAllFlights`) is true — non-admins never see it and always get the server-side-scoped
own-flights query, same as before this toggle existed.

- **Unterlagen (PDFs for members)**: `DroneDocument` stores the PDF bytes directly in Postgres
  (`data Bytes`) rather than on a filesystem/volume — deliberate, since the expected volume is a
  handful of small documents, and this way there's no extra Docker mount to provision and the
  files ride along automatically in the existing `pg_dump` backup. List queries (`/admin/drohnen`,
  `/drohnen/unterlagen`) always `select` metadata only (never `data`) to avoid pulling PDF bytes
  into memory just to render a list; only the single-document download route
  (`/drohnen/unterlagen/[id]/route.ts`) fetches the full row. Upload/delete live on `/admin/drohnen`
  (gated `isSiteAdmin`, same as the rest of that page) rather than a new admin page — the "Flug
  registrieren"/"Drohnen"-style precedent here is to add a section to an existing admin page, not a
  new nav entry (`AdminSidebarNav`/`AdminMobileTabs`), unless the feature needs its own URL. The 1MB
  default Server Action body
  limit was raised app-wide to 10MB (`next.config.mjs`) specifically for this upload, since Server
  Actions have no per-route size config.
- **90-day/3-flight rule**: constants and the shared cutoff/predicate helpers live in
  `src/lib/drone/ninety-day-rule.ts` (`NINETY_DAY_REQUIRED_FLIGHTS`, `NINETY_DAY_WINDOW_DAYS`,
  `getNinetyDayCutoff()`, `meetsNinetyDayRule()`) — both the Admin-only `/drohnen/90-tage` report (all
  members) and the `NinetyDayRing` every member sees for *themselves* on `/drohnen` read from here, so the
  rule can never drift between the two views. `getComplianceUntilDate()` (same file) projects the date the
  rule would lapse with no further flights: it's 90 days after the `NINETY_DAY_REQUIRED_FLIGHTS`-th most
  recent flight still inside the window — that's the specific flight whose expiry would drop the count below
  the threshold, not simply the oldest flight in the window.

**Drohnengruppe V2 (Signalrot-Mockup-Angleichung)** — the three items below (`NinetyDayRing`,
`GroupStatusChart`, `PurposeBadge`) were one pass to bring this module in line with the "Signalrot" design
mockup, done first among the four modules; Kalender's equivalent pass ("Kalender V2") followed it.

- **`NinetyDayRing`** (`src/components/drone/ninety-day-ring.tsx`) replaced a plain colored `<span>` badge
  that only explained itself via a `title` tooltip — undiscoverable on touch devices, since there's no hover.
  It's a hand-rolled SVG ring (`stroke-dasharray`/`stroke-dashoffset`), not a chart library, matching this
  codebase's "no icon/chart dependency, inline SVG" convention elsewhere (e.g. the edit-pencil icon in
  `user-management-section.tsx`).
- **`GroupStatusChart`** (`src/components/drone/group-status-chart.tsx`), a per-pilot bar chart of 90-day
  compliance, is rendered on `/drohnen` only when `canViewAllFlights(user)` (Admin Drohnengruppe) — deliberately
  the same permission as the existing `/drohnen/90-tage` report, not opened up to all members. Showing every
  pilot's name next to a compliant/non-compliant color is more exposing than what a regular member could see
  before (only their own status), so this was a conscious choice confirmed with the app owner rather than
  matched blindly to a design mockup that had no permission model behind it.
- **`PurposeBadge`** (`src/components/drone/purpose-badge.tsx`) renders "Einsatz" as a solid brand-red pill and
  "Übung" as an outlined neutral pill, used in both `FlightTable`'s desktop row and its mobile `FlightCard` —
  a single shared component so the two views can't diverge on this styling.
- **Flight-created email notification**: `src/lib/drone/notify-flight-created.ts` is the single place that
  builds and sends the "neuer Drohnenflug" email (reads the recipient from `AppSettings` via
  `getDroneFlightNotificationEmail()`, no-ops if unset, swallows send errors so a Mailjet outage never blocks
  saving a flight). Called from both `createFlight` (normal form) and the QR quick-register action below —
  don't duplicate the email-building logic at either call site again.
- **QR-code quick registration** (`src/app/drohnen-schnell/[token]/*`): a fully public, no-login page meant
  to be printed as a QR code so a pilot can log a flight on their phone without signing in. Gated purely by
  a bearer token stored in `AppSettings.droneQuickRegisterToken` (generated/rotated from `/admin/drohnen`,
  same shape as `Organization.icsToken` — an unguessable capability URL, not a password). The server action
  re-checks the token itself (never trusts that the page-level check ran). Flights created this way are
  attributed to a dedicated, `isActive: false` system user (`src/lib/drone/quick-register-user.ts`,
  lazily upserted by email `drohnen-schnellerfassung@system.local`) instead of a real session — this is what
  makes the link create-only: that user can never log in, so nothing it "owns" can be read back or edited
  through this path, only by an Admin Drohnengruppe via the normal UI. Don't route this flow through
  `requireUser()`/a real login — that would reintroduce a shared-session risk the token design avoids.

### Verwaltung (shadcn/ui-Grundlage)

Verwaltung wird laut `Verwaltung-Brief.md` (Claude Design) modul-für-modul auf shadcn/ui umgestellt — die
**erste UI-Bibliothek in dieser Codebase**, die sonst konsequent alles handrollt (`ToggleSwitch`,
`BottomSheet`, Inline-SVGs statt Icon-Library, Mailjet per rohem `fetch` statt SDK). Bewusste, dokumentierte
Ausnahme: Verwaltung braucht mehrere barrierefreiheitskritische Bausteine (fokus-fallenbehafteter Sheet,
DropdownMenu, AlertDialog), bei denen Radix' geprüfte Fokus-/ARIA-/Tastatur-Logik einem Handbau vorzuziehen
ist. Es existieren dadurch dauerhaft zwei Komponenten-Philosophien nebeneinander (Verwaltung=shadcn, Rest der
App=handgerollt) — kein Versehen, kein geplanter Umbau des restlichen Codes auf shadcn.

- **Tailwind-Versions-Stolperstein**: `npx shadcn@latest` (aktuell v4.16) generiert standardmäßig für
  Tailwind v4 (`@import "tw-animate-css"`/`@import "shadcn/tailwind.css"` in CSS, `oklch()`-Farben, kein
  `tailwind.config.ts`-Eintrag) — dieses Projekt läuft aber auf Tailwind v3.4.17. Die CLI-generierten
  globals.css-/tailwind.config.ts-Änderungen wurden deshalb verworfen und **von Hand** durch die klassische
  v3-taugliche Variante ersetzt: CSS-Variablen mit fertigen Hex-Werten direkt in `globals.css`'s zweitem
  `:root`-Block (eigene Namen wie `--surface`/`--ink`/`--brand-hover`, bewusst NICHT `--background`/
  `--foreground` wiederverwendet, da diese beiden Namen bereits app-weit das `<body>`-Hintergrund/-Textfarbe
  aus dem ursprünglichen "Signalrot"-Pass tragen), plus die passenden `theme.extend.colors`-Einträge in
  `tailwind.config.ts` (sowohl die Brief-eigenen Tokens `ink`/`line`/`surface`/`success`/`warning`/`danger`
  als auch die von generierten shadcn-Komponenten erwarteten Alias-Namen `background`/`foreground`/`card`/
  `popover`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring` — beide Gruppen
  zeigen auf dieselben CSS-Variablen, nicht doppelt gepflegt). `tw-animate-css` (v4-only) wurde durch
  `tailwindcss-animate` (v3-kompatibel, in `plugins: []` registriert) ersetzt; `shadcn`/`radix-ui`-Pakete
  wurden dabei nicht durch eigene Einzelpakete ersetzt, da `radix-ui` selbst schon das aktuelle, gebündelte
  Radix-Meta-Package ist (kein v4-spezifisches Detail, sondern nur die neuere Verpackung vieler
  `@radix-ui/react-*`-Pakete in einem). `darkMode: 'class'` wurde explizit gesetzt (statt Tailwinds Default
  `'media'`), obwohl nirgends eine `.dark`-Klasse gesetzt wird — sonst würden `dark:`-Varianten in
  generiertem shadcn-Code (kommen vereinzelt vor, z. B. im Button) auf `prefers-color-scheme: dark`
  reagieren, obwohl die App bewusst fixed-light ist (`color-scheme: light`, kein Theme-Umschalter). Ein paar
  rein kosmetische v4-only-Utility-Klassen in generierten Komponentendateien (z. B. `origin-(--radix-...)`,
  `**:`-Descendant-Variant in `tooltip.tsx`) erzeugen unter v3 einfach keine zusätzliche Regel (kein Build-
  Fehler, nur ein minimal weniger präziser Animations-Ursprung) — bewusst nicht einzeln von Hand gepatcht,
  da der Aufwand den kosmetischen Nutzen nicht rechtfertigt.
- **Echter Bug aus derselben Ursache, nicht nur kosmetisch (gefunden nach einem Nutzerbericht: "Aktiv"-
  Switch und Drohnengruppe-RadioGroup in `UserFormSheet` ließen sich optisch nicht auswählen)**: Tailwind v4
  führt automatisch generierte, klammerlose `data-*:`-Varianten für JEDEN beliebigen Data-Attribut-Namen ein
  (`data-checked:`, `data-open:`, `data-active:`, …, matcht `[data-x]`-Präsenz) — Tailwind v3.4.19 kennt diese
  Kurzform nicht (nur die Klammer-Syntax `data-[attr]:`/`data-[attr=wert]:` funktioniert, empirisch mit
  `npx tailwindcss -i ... --config tailwind.config.ts` gegen ein Test-HTML verifiziert: `data-checked:` und
  `data-[state=checked]:` sehen im generierten Code gleich harmlos aus, aber nur letzteres erzeugt tatsächlich
  eine CSS-Regel). Der von `npx shadcn add` generierte Code verwendet diese v4-Kurzform großflächig für
  Radix' `data-state`/`data-orientation`/`data-disabled`-Attribute — unter v3 blieben dadurch `Switch`,
  `RadioGroup` und `Checkbox` (`data-checked:bg-primary` etc.) **optisch dauerhaft im "nicht ausgewählt"-
  Zustand eingefroren**, unabhängig davon, ob der zugrunde liegende Radix-/react-hook-form-Zustand beim Klick
  korrekt umschaltete — ein Nutzer, der klickt und keine visuelle Reaktion sieht, empfindet das zu Recht als
  "kann nicht ausgewählt werden". Jede betroffene Datei wurde anhand des tatsächlich von der installierten
  `@radix-ui/react-*`-Version gesetzten Attributs korrigiert (per `grep` in `node_modules/@radix-ui/react-*/
  dist/index.mjs` verifiziert, nicht geraten): `switch.tsx` (`data-[state=checked]`/`data-[state=unchecked]`/
  `data-[disabled]`), `radio-group.tsx`/`checkbox.tsx` (`data-[state=checked]`), `select.tsx`
  (`data-[placeholder]`/`data-[disabled]`), `separator.tsx`/`tabs.tsx` (`data-[orientation=horizontal|
  vertical]`, `tabs.tsx` zusätzlich `data-[state=active]` — Tabs selbst wird aktuell nirgends im Code
  verwendet, aber derselbe Fehler wurde vorsorglich behoben, bevor die Komponente je in Gebrauch kommt).
  Zusätzlich (rein kosmetisch, keine Funktionseinbuße, da Radix Öffnen/Schließen ohnehin selbst steuert, nur
  bislang ohne Ein-/Ausblend-Animation): dieselbe Korrektur (`data-open:`/`data-closed:` →
  `data-[state=open]:`/`data-[state=closed]:`) in `dialog.tsx`, `sheet.tsx`, `alert-dialog.tsx`,
  `dropdown-menu.tsx` (dort zusätzlich `data-inset:` → `data-[inset=true]:`, ein von der Komponente selbst
  gesetztes, nicht Radix-generiertes Attribut) und `tooltip.tsx` (`data-open:` entspricht dort dem von Radix
  Tooltip gesetzten `data-state="instant-open"`, nicht `"open"` — ebenfalls am tatsächlichen Paket-Quellcode
  verifiziert statt angenommen). Ein `grep -noE "data-[a-z-]+:" src/components/ui/*.tsx | grep -v "data-\["`
  über den gesamten Ordner findet danach keine bare Variante mehr — die Suche nach zukünftig neu
  hinzugefügten shadcn-Komponenten sollte denselben Check vor dem Commit wiederholen.
- `tailwind.config.ts` braucht `import tailwindcssAnimate from 'tailwindcss-animate'` statt
  `require('tailwindcss-animate')` im `plugins`-Array — dieses Next-15-Setup lädt `tailwind.config.ts` in
  einem Kontext, in dem `require` zur Laufzeit nicht definiert ist (`ReferenceError: require is not defined`),
  nur `import`/ESM funktioniert.
- shadcn-Komponenten installiert (in `src/components/ui/`, eigene Dateinamen, keine Kollision mit den
  bestehenden Handbau-Dateien dort): `table`, `badge`, `button`, `input`, `select`, `switch`, `dialog`,
  `sheet`, `dropdown-menu`, `tabs`, `tooltip`, `skeleton`, `alert-dialog`, `separator`, `checkbox`.
  `sonner` (Toast) wurde bewusst NICHT über `npx shadcn add sonner` (das nur einen dünnen
  Wrapper generiert) hinzugefügt, sondern das rohe `sonner`-Package direkt in `(app)/layout.tsx` als
  `<Toaster theme="light" position="top-right" richColors />` eingehängt. `TooltipProvider`
  (`components/ui/tooltip.tsx`) wrappt ebenfalls in `(app)/layout.tsx`, wie von der CLI selbst verlangt.
- Barlow Condensed (`--font-barlow-condensed`, `font-condensed`) neu in `src/app/layout.tsx`/
  `tailwind.config.ts` ergänzt, ausschließlich für Kennzahlen (Mitgliederzahl-Kacheln) laut Brief — nicht als
  allgemeine Schriftfamilie, Barlow bleibt der Fließtext-Font app-weit.

### Verwaltung (admin) navigation

**Phase 2 (Verwaltung-Brief.md)**: `src/app/(app)/admin/layout.tsx` now gates all `/admin/*` pages centrally
(`requireUser()` + `notFound()` if `!isSiteAdmin(user)`) instead of each page independently returning a plain
"nur für die Abschnittskommando-Verwaltung sichtbar" fallback — a non-admin now gets a real 404, not an empty
page with friendly text. This only protects the page **render**; the pre-existing `assertPermission(
isSiteAdmin(...))` calls inside every admin Server Action (13 call sites, unchanged) still do the actual
authorization work, since a layout can't stop a Server Action invoked directly. The old horizontal pill nav
(formerly `components/layout/admin-nav.tsx`, `AdminNav`) is replaced by a fixed 210px-left-sidebar
(`components/admin/admin-sidebar.tsx` + `admin-sidebar-nav.tsx`, `md:` and up only — mobile gets its own
tabs-based nav, see Phase 6/7 below) rendered once by the layout, not per-page. `AdminNav` was intentionally
**left in place but unused** through Phases 2–6 to avoid a half-migrated state where some pages had a sidebar
and others still rendered the old pill row; it was deleted for good in Phase 7 once every admin page had its
own replacement nav (`AdminSidebar`/`AdminMobileTabs`) — `grep -rn "AdminNav"` now returns no functional
references, only the historical mentions in this file.
`AdminSidebar` additionally shows a 3-row status summary (Datenbank/Mailjet/Zeitserver, click → `/admin/status`)
via a new `getAdminSidebarStatus()` in `lib/system/system-check.ts` — a subset of 3 of the 8
`getSystemCheckResult()` signals, wrapped in `unstable_cache(..., { revalidate: 60 })` since the sidebar
renders on every single admin page navigation; without the cache, every click within Verwaltung would
trigger a live DB query + Mailjet API call + external NTP fetch just to paint three status dots. Add a new
admin page by (1) letting the shared layout's gate cover it (no per-page `isSiteAdmin` check needed), (2)
adding one entry to `AdminSidebarNav`'s `ITEMS`.

**Phase 3 (Benutzertabelle)**: `user-management-section.tsx` was rewritten on shadcn `Table`/`Badge`/
`DropdownMenu`/`AlertDialog`/`Checkbox`/`Select`/`Input`. Filter/sort state (`q`/`feuerwehr`/`rolle`/`status`/
`sort`/`dir`) is mirrored into the URL via `router.replace(..., { scroll: false })` — the **first use of
URL-synced state in this codebase** — but stays a pure bookmark/share mechanism: filtering/sorting itself is
still entirely client-side `useMemo` over the one server-fetched `UserRow[]` array (184 rows doesn't justify
server-side filtering or a network round-trip per keystroke), the URL is just kept in sync with whatever the
client already computed. The search input debounces 300ms before updating both the filter and the URL;
selects/sort update immediately. `UserRow` gained `homeOrganizationId`/`isAdmin`/`isActive` (raw values, not
just their display strings) specifically so filters can match reliably instead of comparing rendered text.
`name` is now built as `"${lastName} ${firstName}"` (brief's "Nachname Vorname"), a real behavior change from
the previous "Vorname Nachname" order. Two new, deliberately thin server actions
(`bulkSetActive`/`bulkSetHomeOrganization` in `actions.ts`) back the new multi-select action bar — the brief's
own "don't reinvent Server Actions" instruction was about not touching `createUser`/`updateUser`/`deleteUser`,
not a prohibition on adding new ones the existing UI never needed; both call `prisma.updateMany` directly
rather than looping the full `userSchema` validation, since a boolean toggle / org reassignment across many
rows needs no per-row form validation. `setUserActive` (also new) is the same pattern for the single-row
"Aktivieren/Deaktivieren" menu item — the old UI only ever toggled this via the full edit form's checkbox.
Row-level actions live in a new `user-row-actions.tsx` (`DropdownMenu` + `AlertDialog`), reusing
`deleteUser`/`sendPasswordResetEmailToUser` unchanged — `deleteUser` is called directly (not via a
`<form action>`) inside `startTransition`, same pattern `UserForm` already used for `createUser`/`updateUser`;
Next's Server Action redirect handling works identically either way. Clicking "Bearbeiten" (or a table row)
still navigates to the existing `/admin/benutzer/[userId]` page — Phase 4 turns that into a `Sheet` opened
in place; this phase deliberately didn't touch that yet. Push is now a live count + `title` tooltip listing
each `PushSubscription.createdAt` (`"Registriert seit ..."` per device) — there's no device-name field in the
schema to show a real "Gerätename" as the brief's wording literally suggests, so the tooltip shows dates only,
not a fabricated device label.

**Phase 4 (Detail-Sheet)**: `createUser`/`updateUser`'s form moved from two dedicated pages
(`/admin/benutzer/neu`, `/admin/benutzer/[userId]`) into `components/admin/user-form-sheet.tsx`
(`UserFormSheet`) — a shadcn `Sheet` (`side="right"`, `sm:max-w-[520px]`) opened directly from the table
(row click, a row's "Bearbeiten" menu item, or the "Neuer Benutzer" button), with four single-column sections
(Person/Zugang/Zuordnung/Drohnengruppe) replacing the old two-column grid — "die Feldlängen sind zu
unterschiedlich" per the brief. Both old routes **still exist and stay valid deep links** (e.g. a bookmarked
edit URL) but now just `redirect()` to `/admin/benutzer?edit=<id>` / `?new=1`; `UserManagementSection` reads
those two params once (lazy `useState` initializer) to open the sheet pre-populated, then its existing
filter-sync effect naturally strips them back out of the URL on the next render (they were never part of that
effect's own tracked param set). This meant extending `UserRow` with raw fields the display columns didn't
need (`firstName`/`lastName` separately, `adminOrgIds: string[]`, `droneRole`) so opening the sheet for any
row never needs a second server round-trip — the table already fetched everything. The old
`delete-user-button.tsx`/`password-reset-email-button.tsx`/`components/admin/user-form.tsx` are gone entirely
(superseded by `user-row-actions.tsx` and `UserFormSheet`, not kept as unused fallbacks — unlike `AdminNav`,
which stays until step 7 specifically because deleting it now would strand three still-unmigrated pages).
Closing the sheet with unsaved changes shows a shadcn `AlertDialog` ("Änderungen verwerfen?") instead of
`window.confirm()` — implemented by keeping `open` fully controlled by the parent and simply not propagating
a close request through when `formState.isDirty` is true, showing the confirm dialog instead; confirming
sets the real `open=false`. The "no welcome email → show the activation link to copy" flow (unchanged
behavior, just relocated) now swaps the sheet's body to that panel instead of navigating to a fresh page.
`createUser`/`updateUser` still call `redirect('/admin/benutzer')` on success internally, unchanged — called
directly from the client (not a `<form action>`) inside `startTransition`, the same pattern already used
before this phase and still works identically.

**Bugfix (GitHub issue #7, found after Phase 7)**: this single-shared-Sheet design had a real regression
Phase 4 introduced and never caught — `UserFormSheet` is one always-mounted component instance (unlike the
old `UserForm`, which got a fresh page mount, and therefore a fresh `useForm()` call, on every single edit).
`react-hook-form`'s `defaultValues` are only read once, on the very first `useForm()` call for a given
component instance; changing the `target` prop on later renders does **not** update the already-registered
input values. In practice this meant every row you clicked after the first one opened a Sheet still showing
whichever user's data happened to populate it first — reported as "only admin@abschnitt-purkersdorf.at is
showing, can't select another user to edit." Fixed by extracting `buildDefaultValues(target, mode,
organizations)` and calling `reset(buildDefaultValues(...))` in a `useEffect` keyed on
`[open, target?.id, mode]` — i.e. every time the sheet is freshly opened for a (possibly different) target,
not just once at mount. While fixing this, also caught and fixed a real `isActive` default bug in the same
object literal: `target?.isActive ?? mode === 'create' ? false : true` — `??` binds tighter than `? :`, so
this parsed as `(target?.isActive ?? (mode === 'create')) ? false : true`, which inverted the "Zugang aktiv"
toggle's default for every edit (a deactivated user's edit sheet defaulted the toggle to *on*, and vice
versa) regardless of the stale-defaultValues bug above. Fixed with explicit precedence:
`target ? target.isActive : mode === 'create' ? false : true`.

**Phase 5 (Lade-/Leer-/Fehlerzustände)**: most of this phase's asks were already satisfied incidentally by
earlier phases (the "leer nach Filterung" message + "Filter zurücksetzen" button from Phase 3; specific,
non-generic `toast.error(...)` text throughout Phase 3/4's row/bulk/sheet actions, never a bare "Fehler").
What was actually new: `src/app/(app)/admin/benutzer/loading.tsx` — Next's App Router Suspense-fallback
convention, shown automatically both on first page load and on the `router.refresh()` calls Phase 3's bulk
actions already trigger, six `Skeleton` rows in table form as the brief specifies (no spinner) — this file
needs no data since it's a pure static shell shown *before* `page.tsx`'s data arrives. `user-management-
section.tsx`'s single empty-state branch was split into two: `users.length === 0` ("Noch keine Benutzer
angelegt" + Excel-Import as the primary action) is now distinct from `sorted.length === 0` ("Keine Benutzer
entsprechen den Filtern" + "Filter zurücksetzen") — the brief treats these as two different states with
different primary actions, the old code collapsed them into one message. `UserFormSheet`'s save button also
got an actual spinner icon (inline SVG, `animate-spin`, matching this codebase's hand-rolled-icon convention)
next to its "Speichern…" text while pending — the brief's "kein Spinner" rule is specifically about the
list's own loading state (a static skeleton reads calmer for a whole-page wait), not the save button, which
it explicitly asks to show one for.

**Phase 6 (Mobile Verwaltung)** — introduced a **second breakpoint reconciliation** within this module:
Phases 2's sidebar already switched at `md:` (768px, matching the brief's own "< 768px" heading literally,
unlike Kalender/Drohnengruppe's `sm:`/`lg:` elsewhere in the app), but Phase 3's table/card switch had been
built at the app-wide `sm:` (640px) default — leaving an inconsistent 640–767px gap where the sidebar was
already gone (`md:`-gated) but the desktop table was still showing (`sm:`-gated), with no navigation at all
in that range. Fixed by moving every "mobile shell vs desktop shell" class in
`user-management-section.tsx` from `sm:` to `md:` (a plain find/replace, confirmed by grep beforehand that
no other `sm:` usage in that file needed to stay — the column-density `xl:` breakpoint for
email/Drohnengruppe/Push is untouched, that's a separate concern). `components/admin/admin-mobile-tabs.tsx`
(new) is a horizontal-scroll pill nav, deliberately a **separate component** from `AdminSidebarNav` rather
than a shared one — same `ITEMS` list duplicated once, but the visual language (pills vs. sidebar rows) is
different enough that sharing would need conditional rendering internally; rendered directly inside
`UserManagementSection` right after its own title (not in `admin/layout.tsx`) since "unter dem Titel" only
makes structural sense from inside the page that owns that title — Phase 7 adds the same one-line call to
the other three pages once they get real titles.

The desktop-only Select filter row (`hidden md:flex`) and the search `Input` (always visible - "Inhalt
zuerst" the same way Kalender's mobile filter sheet keeps its segmented control inline) were split apart;
the row's JSX became a `filterControls` local variable (not a separate component with props - it closes over
the same `feuerwehr`/`rolle`/`status`/`organizations` state already in scope) reused verbatim inside a new
`Sheet side="bottom"` triggered by a filter icon registered into `MobileHeaderContext`'s action slot via
`useEffect` — the exact same slot Kalender's own mobile filter button already uses (only one page is ever
mounted at a time, so there's no conflict). `UserFormSheet`'s width override needed the same
`data-[side=right]:` variant prefix as shadcn's own generated classes (`data-[side=right]:w-full
data-[side=right]:sm:max-w-none data-[side=right]:md:w-[520px] data-[side=right]:md:max-w-[520px]`) to
reliably win the `cn()`/tailwind-merge conflict resolution against the component's built-in `w-3/4`/`sm:max-w-sm`
— a bare `sm:max-w-[520px]` (what Phase 4 originally shipped) left the sheet at 75% width below `sm:` and a
384px cap in the 640–767 gap, neither of which is the "Vollbild-Sheet" the brief asks for on mobile.

Verification note: unlike Phases 3-5, this phase's core claim (responsive layout switching four different
`hidden md:*`/`md:hidden` pairs correctly) is CSS-driven and doesn't depend on the hydration that's confirmed
broken in this browser-automation environment — verified directly via `getComputedStyle(...).display` at
390px and 1024px viewports against a real logged-in session, confirming all of: sidebar ↔ tabs,
table ↔ card-list, desktop filter row ↔ hidden, stat cards ↔ hidden, fixed CTA ↔ header button, each showing
the correct side at the correct width, plus the card's exact rendered text ("Admin Abschnitt" · "Aktiv" ·
"Purkersdorf · Admin") and its `min-height: 44px` tap target. What remains unverifiable for the same
already-documented reason: the mobile header's filter-icon `useEffect` registration never fires (confirmed
absent from the DOM at 390px), and the Sheet/bottom-sheet's actual open/close interaction — both depend on
client-side effects that don't run when hydration doesn't attach, exactly like Phase 4's detail sheet.

Verification note: this browser-automation environment does not hydrate client-side React on this page at
all in the current session (confirmed via `__reactFiber$`/`__reactContainer$` lookups on `document.body`
finding none, even after waiting) — the same harness-wide gap already documented for Mobile-Brief.md, now
additionally confirmed to block Radix Portal-based content (`Sheet`/`Dialog`/`DropdownMenu`/`Select`) from
ever mounting in a static DOM snapshot here, regardless of the underlying React state's correctness, since
portal content only exists post-hydration. Directly submitted `<form>` elements (e.g. login) still work since
those are native browser submissions Next progressively enhances, not pure client reactivity. What *was*
verified: both old routes correctly `redirect()` to the new query-param URLs (confirmed via
`window.location.href` after navigating), the resulting pages return 200 with all JS chunks loading
successfully and zero console errors, and (Phase 3) filtering/sorting/chip/empty-state logic via direct URL
query params against seeded data. The `Sheet`'s actual open/close/submit/discard-confirm interaction could
not be exercised end-to-end in this environment — flagged transparently rather than claimed as tested.

**Phase 7 (Drohnengruppe/E-Mail/Status + `AdminNav`-Löschung)** — the final phase, bringing the three
remaining `/admin/*` pages onto the same shadcn/`AdminMobileTabs`/`getComputedStyle`-verified foundation as
`/admin/benutzer`, and removing the now fully superseded `AdminNav`. Purely a surface rebuild — no Server
Action logic changed on any of the three pages.

- **`/admin/drohnen`**: gained a page title, `<AdminMobileTabs/>`, and its drone table restyled onto shadcn
  `Table`/`Badge` (`RenameDroneForm`/`toggleDroneActive` untouched). New: a "Mitglieder · 90-Tage-Status"
  section reusing `listDrohnengruppeMembers()` + `getNinetyDayCutoff()`/`meetsNinetyDayRule()` +
  `prisma.droneFlight.groupBy({by:['pilotUserId'], where:{startsAt:{gte:cutoff}}})` — the *exact* query
  pattern from `/drohnen/90-tage/page.tsx`, not reinvented — rendered as a `Table`/`Badge` (Erfüllt/Offen)
  with each row linking to `/admin/benutzer?edit=<id>` for editing rather than adding new member-management
  actions this page never had. This section is gated on `canViewAllFlights(user)` **in addition to** the
  page's own `isSiteAdmin` gate from `admin/layout.tsx` — the same reasoning as `GroupStatusChart` on
  `/drohnen` (see Drohnengruppe V2 above): `isSiteAdmin` and `isDroneGroupAdmin`/`canViewAllFlights` are
  independent rights, so a site admin who isn't also Admin Drohnengruppe must not automatically see
  pilot-by-pilot compliance data. Verified live: logged in as the seeded site admin (who lacks
  `canViewAllFlights`), the section is correctly absent from the rendered page — confirming the gate works,
  not just that it compiles. The QR-code and Unterlagen cards were restyled onto `bg-surface`/`shadow-card`
  tokens with no functional change.
- **`/admin/email`**: gained a title + `<AdminMobileTabs/>`; its three cards (`DroneFlightEmailForm`/
  `SystemCheckEmailForm`/`TestMailjetForm`, internals untouched) now sit in a `max-w-[640px]` single column
  per the brief's explicit "nicht über die volle Fensterbreite gezogen" — confirmed via
  `getComputedStyle(...).maxWidth === '640px'` against the live page, deliberately narrower than the
  full-width table pages since this page is only ever short, one-line forms.
- **`/admin/status`**: `SystemCheckPanel` rewritten from colored-dot cards to a single bordered list —
  label left, a small status dot + the same `row.detail` value in `font-mono` right, one "Zuletzt geprüft"
  timestamp underneath the whole list (not per-row, since several rows' own `detail` text already embeds a
  timestamp) — and rows are now sorted failing-first (`Number(a.ok) - Number(b.ok)`, stable so same-status
  rows keep `buildSystemCheckRows`' original order). `runSystemCheck()`/`buildSystemCheckRows()` themselves
  are unchanged, only the presentation. The "Jetzt prüfen" click itself could not be exercised end-to-end in
  this browser-automation session — clicking produced no network request, consistent with the
  already-documented hydration gap above (`onClick` handlers don't fire when React never attaches), not a
  regression in this phase's code.
- `AdminNav` (`src/components/layout/admin-nav.tsx`) is **deleted** — confirmed via `grep -rn "AdminNav"`
  that no functional references remained (only this file's own historical prose mentions it), now that every
  `/admin/*` page has its own `AdminSidebar`/`AdminMobileTabs` nav. This closes out the Verwaltung-Brief.md
  7-phase plan.

- `/admin/benutzer` — `UserManagementSection` (client) owns free-text search and click-to-sort-any-column
  over a flat `UserRow[]` the server maps the Prisma result into; don't push search/sort server-side, ~200
  users is small enough to do it in the browser. The "Willkommen-E-Mail senden" toggle (default on, now inside
  `UserFormSheet`'s create mode) still creates the user + activation token either way — turning it off just
  skips `sendActivationEmail` and instead swaps the sheet's body to show the activation link (with a copy
  button) for the admin to hand over manually; there's no way today to retrieve that link again afterward if
  the admin closes the sheet without copying it (the admin-triggered password-reset email is a separate,
  unrelated flow for existing users, not a way to recover this). `User.stbNr`/`User.phone` (Standesbuchnummer,
  E.164 phone) are plain optional fields with no DB-level uniqueness — `phone` is only format-validated
  (`E164_PHONE_REGEX` in `lib/validation/user.schema.ts`), and create mode pre-fills `+43` as a starting point
  (edit mode leaves it untouched).
- **Excel export/import** (`/admin/benutzer/export`, `/admin/benutzer/import`): both read/write the same
  column set from `lib/admin/user-excel-columns.ts` (`USER_EXCEL_COLUMNS`) — the export is deliberately also
  the import template (same header names), so re-uploading an unmodified export works without edits. Export
  includes active *and* deactivated users (no `isActive` filter) and extra columns (Admin für, Drohnengruppe,
  Status) that the import ignores (`USER_IMPORT_COLUMN_KEYS` is the subset it actually reads). Import matches
  existing users by **StbNr + Heimat-Feuerwehr** (not email) to decide what's a duplicate to skip vs. a new
  row to create; header names are resolved from row 1 rather than assumed to be in a fixed column order.
  Rows are processed independently (one bad row records an error message and moves on, doesn't abort the
  batch). A single "Willkommen-E-Mail senden" Ja/Nein select applies to the whole batch (default Ja) —
  when Nein, `importUsers` still creates every user and its `PasswordToken` as normal but skips
  `sendActivationEmail` and instead collects `{name, email, link}` per created user, returned to the client
  and rendered as a list of activation links with copy buttons (same `CopyLinkButton`/link-expiry pattern as
  the single-user form's own Nein path) — there's no per-row toggle, only one setting for the entire upload.
- `/admin/status` — `SystemCheckPanel` calls `runSystemCheck()` only on button click (not on page load).
  "Docker läuft" is actually a live `SELECT 1` through Prisma, not a Docker-daemon check (the app container
  can't see the host daemon) — a successful query proves the app ↔ Postgres Compose network path is up,
  which is the practically useful signal. "Mailjet Integration" is a read-only, non-sending authenticated
  call (`checkMailjetConnection` in `mailjet.ts`) against Mailjet's own API-key endpoint. Three more checks
  work around the same "app container can't see the host" limit that shapes "Docker läuft": "Cron Job
  (News)" and "Letztes Backup" don't probe the host directly (no visibility into the host crontab or
  `docker/backups/`) — instead the cron endpoint (`/api/cron/send-scheduled-news`) calls
  `recordNewsCronRun()` on every invocation (even when nothing was due) and `docker/backup.sh` runs a direct
  `psql` UPSERT after each successful `pg_dump`, both writing into `AppSettings.lastNewsCronRunAt` /
  `lastBackupAt`; the Status page only reads those columns back via `src/lib/settings.ts` and flags them
  stale after 15 minutes (cron runs every 5) / 26 hours (nightly backup) respectively. `docker/backup.sh` and
  `docker/send-scheduled-news.sh` are tracked executable in git (`git update-index --chmod=+x`) — both run
  directly off the host checkout via cron with no build step to fix the mode for them (unlike
  `entrypoint.sh`, which the `Dockerfile` `chmod +x`s during the image build). A real incident: both scripts
  were committed non-executable, so every cron invocation since initial deploy silently failed with
  `Permission denied` into their respective log files, with no other visible symptom — don't let a future
  `git add` of a new host-cron script re-introduce this; check `git ls-files -s` shows `100755` for it.
  `backup.sh` additionally uploads the dump to an S3-compatible bucket (Exoscale SOS) when
  `S3_BACKUP_BUCKET` is set in `.env`, purely as an off-box copy alongside the existing local one — see
  "Off-Box-Kopie" in `docker/README.md`. It also tars up `.env` and `docker/Caddyfile` into a
  `config-<timestamp>.tar.gz` (`chmod 600`, deleted locally right after upload) and uploads that too — the DB
  dump alone can't restore a working server: `.env` is `.gitignore`d and only ever exists on this one host,
  and losing `VAPID_PRIVATE_KEY` specifically would permanently strand every `PushSubscription` row the DB
  restore brings back, forcing all ~200 members to re-enable push by hand. The config archive isn't kept
  locally (no local retention line to maintain for it) since the source files already sit right next to
  `backup.sh` on disk — a local copy of them would add no protection a full-disk loss wouldn't also destroy.
  Retention for the S3 copies is scripted directly in `backup.sh`
  (list objects older than 30 days via `aws s3api list-objects-v2`, then `aws s3 rm` each), mirroring the
  local `find -mtime +30`, rather than a bucket lifecycle rule — confirmed by testing that Exoscale SOS has
  no native lifecycle support at all yet (`PutBucketLifecycleConfiguration` either silently no-ops or
  errors `MalformedXML` depending on the rule shape); their own workaround for this is a separate
  Docker-based tool that additionally requires bucket versioning enabled, which was judged disproportionate
  for a handful of small backup files. "NTP-Synchronisierung"
  can't run a real NTP client check inside the container either (it shares the host's clock, so there's
  nothing container-local to check) — `src/lib/system/ntp-check.ts` instead compares local time against the
  `Date` response header of an external HTTPS call (`api.mailjet.com`) as a drift proxy, flagging >10s as
  out of sync. **"S3 Exoscale Verbindung" and "Letztes S3-Backup" (GitHub issue #2)** cover the off-box
  copy specifically, since the checks above only ever reflected the local `pg_dump` succeeding, not whether
  the S3 upload did: `src/lib/system/s3-check.ts`'s `checkS3Connection()` is a live, read-only `HeadBucket`
  call via `@aws-sdk/client-s3` (the one SDK dependency in this codebase — hand-rolling SigV4 request
  signing over plain `fetch`, the pattern used for Mailjet, was judged too error-prone for something
  security-sensitive) against `S3_BACKUP_BUCKET`/`S3_ENDPOINT_URL`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, returning
  `false` for both "not configured" and "reachable but auth/network failed" — same simple boolean semantics
  as `checkMailjetConnection`, no third state. The AWS SDK requires a `region`; Exoscale SOS endpoints have
  the form `https://sos-<zone>.exo.io` and expect that zone as the signing region, so
  `regionFromEndpoint()` extracts it from `S3_ENDPOINT_URL` rather than hardcoding one. "Letztes S3-Backup"
  is a staleness check on a new `AppSettings.lastS3BackupAt` column, written by `backup.sh` — but
  deliberately placed AFTER the `aws s3 cp` of the DB dump succeeds, not alongside the pre-existing
  `lastBackupAt` write (which happens right after the local `pg_dump`, before the S3 block even runs): the
  script's `set -e` means a failing upload aborts before that `INSERT` is ever reached, so a stale
  `lastS3BackupAt` genuinely means "the off-box copy didn't happen," without needing any extra
  try/catch-style handling in the shell script itself.
- **Daily system-check email**: the same check that powers the `/admin/status` button also runs unattended
  once a day via `/api/cron/system-check` (secret-gated like `/api/cron/send-scheduled-news`) +
  `docker/system-check-email.sh` on the host crontab, mailing the result as a table to an address
  configured under `/admin/email` ("System Check E-Mail", `AppSettings.systemCheckNotificationEmail` via
  `src/lib/settings.ts` — same admin-configurable pattern as "Drohnenflug E-Mail", not hardcoded like
  `FEEDBACK_RECIPIENT`). `src/lib/system/notify-system-check.ts`'s `notifySystemCheckResult()` mirrors
  `notifyDroneFlightCreated()`'s shape exactly: reads the recipient from `AppSettings` and no-ops if unset,
  and wraps the send in try/catch so a Mailjet outage never fails the cron run itself. The manual "System
  Check" button on `/admin/status` calls the exact same `notifySystemCheckResult()` too (not only the daily
  cron) — deliberately, so an admin can trigger a real end-to-end test of the email path (recipient
  configured? Mailjet reachable?) on demand instead of waiting for the next 09:00 run.
  `runSystemCheck()` in `admin/status/actions.ts` is session-gated (`requireUser()` +
  `assertPermission(isSiteAdmin(user))`) and can't be called from a route with no session, so the actual
  check logic was pulled out into a plain `getSystemCheckResult()` in `src/lib/system/system-check.ts`; the
  Server Action is now a thin auth-check wrapper around it. The row-building logic that turns a
  `SystemCheckResult` into label/OK/detail rows (`buildSystemCheckRows`) had to move into its own
  dependency-free `src/lib/system/system-check-rows.ts` rather than living in `system-check.ts` itself —
  `system-check.ts` imports Prisma/Mailjet/NTP checks, and `system-check-panel.tsx` (`'use client'`) needs
  those rows for the UI, so importing the rows builder straight from `system-check.ts` would have pulled
  Prisma into the client bundle. Both the status page and the email call the same `buildSystemCheckRows`, so
  the two never drift out of sync on labels/wording.

### Email

`src/lib/email/mailjet.ts` is a thin `fetch` wrapper around Mailjet's v3.1 Send API (no SDK dependency), plus
`checkMailjetConnection()` for the Status-page health check (read-only, sends nothing). `sendEmail()` wraps
every caller's `htmlPart` in one shared `wrapHtmlPart()` div (`font-family: Arial, Helvetica, sans-serif;
font-size: 15px; ...`) before sending — added after a real inconsistency shipped: an early version of the
"bitte nicht antworten" disclaimer line (see below) had its own smaller/grayer inline style, which stood out
visually against the rest of the same email in a real client. Individual templates can still deliberately
override this for one element via their own inline `style` (e.g. the large monospace login short-code box in
`sendLoginTokenEmail`) since a child's inline style wins over the inherited wrapper value — the point is that
plain paragraphs across a whole email can no longer silently drift apart from each other one template edit
at a time.
`src/lib/email/templates.ts` builds the transactional emails (activation, password reset); `AUTH_URL` is the
base for the links it builds. `src/lib/email/escape-html.ts` (`escapeHtml`) is used wherever free-text or
user-controlled values (flight location, feedback message) get interpolated into an email's `htmlPart` —
`templates.ts` itself predates this and still doesn't escape `firstName`, a known minor gap, but new email
code should use it. `MAILJET_FROM_EMAIL` is `noreply@ff-wolfsgraben.at` (GitHub issue #5) rather than a
monitored address, so the three member-facing templates (activation, password reset, login token) each end
with a short "bitte nicht antworten, bei Fragen wende dich an florian.krebs@feuerwehr.gv.at" line — the same
contact address already hardcoded (by design, see below) for in-app feedback. Admin-facing operational mails
(drone-flight notification, system-check result) don't need this line; the admin who receives them already
knows who to contact. Every template's sign-off reads "Abschnittsfeuerwehrkommando Purkersdorf" — the
`Organization` row's actual name for the AFKDO org (`prisma/seed.ts`) — not the informal "Feuerwehr Abschnitt
Purkersdorf" phrase a couple of templates used until this was flagged as inconsistent; the activation email's
own "Dein AFKDO Purkersdorf" sign-off is a deliberately different, friendlier phrasing and was left alone.
`/admin/email` has a manual "send test email" action for verifying the Mailjet API
key/sender config without triggering a real activation or reset flow, plus the `droneFlightNotificationEmail`
and `systemCheckNotificationEmail` settings (`AppSettings`) editable via `DroneFlightEmailForm` and
`SystemCheckEmailForm` respectively — two near-identical forms/actions kept separate rather than
parameterized into one generic "settings email" component, matching this codebase's general preference for
duplication over a premature shared abstraction for two call sites.

An admin can also trigger the password-reset email directly for a given user from `/admin/benutzer/[userId]`
(`sendPasswordResetEmailToUser`, reuses the same `createToken`/`sendPasswordResetEmail` as the self-service
"Passwort vergessen" flow) — this exists *alongside*, not instead of, the manual "Neues Passwort (optional)"
override already on that form; keep both.

The "Feedback geben" panel in the profile menu (`components/layout/feedback-form.tsx` +
`app/(app)/profile/actions.ts`'s `sendFeedback`) is a 5-star-rating + free-text form that emails a hardcoded
recipient (`florian.krebs@feuerwehr.gv.at`) via the same `sendEmail()` — not admin-configurable like the
drone-flight notification address, by design (it's feedback about the app itself, not an operational setting).

### News module (Web Push)

`/news` sends push notifications to installed devices — gated by `canManageNews` (Abschnittskommando-Admin
only for now; see the comment above that function for why it isn't opened up to `feuerwehrAdminOrgIds` yet).
This is Web Push (VAPID), not a native push service (no APNs/FCM integration) — it rides entirely on the PWA
infrastructure already in place:

- **iOS constraint, not a bug**: push only works on iOS 16.4+ *and* only after the user has added the app to
  their home screen via Safari's "Zum Home-Bildschirm" — a regular Safari tab cannot receive push at all on
  iOS. Android Chrome has no such restriction. `components/layout/push-notifications-toggle.tsx` detects iOS
  and shows an explanatory hint instead of a broken toggle when `Notification`/`PushManager` aren't available.
- **Opt-in is per-device, not per-user**: `PushSubscription` rows key off the browser's own `endpoint` (unique
  per installation), so the same person can have several active subscriptions (phone + laptop). The toggle in
  the profile menu subscribes/unsubscribes the *current* browser only.
- **Status is visible without opening the menu**: `components/layout/profile-menu.tsx` owns the
  `pushSupported`/`pushEnabled` state itself (not `push-notifications-toggle.tsx`) and renders a bell icon in
  the header — green when subscribed, red otherwise/unsupported — next to the profile name, both opening the
  same dropdown. The subscription check has to live in `ProfileMenu` because it's always mounted; the toggle
  component only mounts while the dropdown is open, so state living there couldn't color a bell that's
  visible before the dropdown is ever opened. `PushNotificationsToggle` is a controlled component
  (`enabled`/`onEnabledChange` props) for this reason — don't move its state back to being self-contained.
- **`src/lib/push/web-push-client.ts`** wraps the `web-push` package, configured from `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (generate with `node -e "console.log(require('web-push').generateVAPIDKeys())"`
  inside the running container — see `docker/README.md`). Subscriptions that come back 404/410 (revoked/expired)
  are reported to the caller as `staleIds` and deleted, rather than being retried forever.
- **`src/lib/push/audience.ts`** resolves a `NewsMessage`'s audience (one `Organization` = that org's
  `homeOrganizationId` members, or `DROHNENGRUPPE` = everyone with a `droneMembership`) to a user list;
  **`src/lib/news/send-news.ts`**'s `dispatchNewsMessage()` turns that into subscriptions, sends, and marks
  `sentAt` — idempotent (already-sent messages are a no-op), so it's safe to call from both the "send now"
  path and the scheduled-dispatch cron without double-sending.
- **Scheduling has no in-process worker**: `createNewsMessage` either dispatches immediately or just stores
  `scheduledAt` with `sentAt: null`. Actually delivering scheduled news depends entirely on
  `docker/send-scheduled-news.sh` being in the host crontab (mirrors `docker/backup.sh`'s pattern) hitting
  `/api/cron/send-scheduled-news?secret=...` — a `CRON_SECRET`-gated route, public in `middleware.ts` for the
  same reason `/kalender/ics` and `/drohnen-schnell` are (no session available to a cron job; a capability
  secret substitutes for one). Without that cron entry, scheduled news silently never sends — there's no
  admin-visible warning for a missing cron job today.
- `public/sw.js` handles `push` (shows the notification) and `notificationclick` (focuses an existing tab or
  opens `/kalender`) — both required for anything to actually appear on screen; the manifest/offline-cache
  parts of the service worker are unrelated and untouched by this.

### PWA

`src/app/manifest.ts` (Next.js manifest convention) + `public/icons/*` (cropped from `public/wappen-afkdo.png`
via a one-off PowerShell/System.Drawing script, not checked in) + `public/sw.js` (hand-written, no
`next-pwa`/similar dependency — deliberately minimal: caches only the app shell/offline fallback, does
network-first with an offline-page fallback for GET navigations, and explicitly leaves all POSTs/Server
Actions/API calls untouched so nothing dynamic ever gets stale-cached) + `components/pwa-register.tsx`
(client-side `navigator.serviceWorker.register()`, best-effort). If you regenerate the icons, keep the same
sizes referenced in `manifest.ts`/`layout.tsx` metadata (16/32/180/192/512).

### Visual design ("Signalrot" pass)

A visual redesign proposal ("Signalrot") was produced in Claude Design and checked for desktop/iOS/Android
feasibility before any code changed. The check found the mockup unsafe to adopt wholesale: it's a static
canvas file (Claude Design's own `<x-dc>`/`{{ }}` template syntax, not runnable code) with two parallel
fixed-width mockups (1160px desktop, 390px mobile) and zero `@media` queries, so none of its markup is
reusable — only the color/type language transfers. Its mobile section specifically has no
`env(safe-area-inset-*)` handling anywhere and no `position:fixed` on the bottom tab bar (it only *looks*
fixed inside the mockup's static fake-phone frame), and its News module has no mobile layout for the admin
composer at all (only a "Nachricht senden" trigger button, no destination screen) — adopting the mockup's
bottom-tab-bar navigation for real would mean building genuine safe-area-aware fixed positioning and
designing that missing composer flow from scratch, both real engineering work, not a copy job.

Given that, the color/typography were adopted first as a low-risk V1 pass, with the mockup's bottom-tab-bar
mobile navigation deliberately built as a separate V2 afterward rather than alongside the color change, once
the safe-area/z-index/responsive-table design questions below had been thought through and planned properly.
Both passes have since shipped and been confirmed bug-free on real devices. What changed in V1, as one
coordinated token update (not scattered one-off hex edits) so the app shell, `<body>` fallback, PWA chrome,
and browser UI chrome (address bar color on Android) never drift out of sync with each other:
- `tailwind.config.ts`'s `colors.brand.DEFAULT` (`#f44336` → `#e4322b`; `brand.dark` was already an exact
  match at `#c62828`, unchanged) and `fontFamily.sans`/`fontFamily.mono` (Noto Sans → Barlow via
  `next/font/google` in `src/app/layout.tsx`'s `--font-barlow` variable; new `--font-ibm-plex-mono` variable
  added and wired to Tailwind's `mono` token, picked up automatically by the one pre-existing `font-mono`
  usage in `login-form.tsx`'s short-code field)
- `globals.css`'s `--background`/`--foreground` (`#f4f4f4`/`#333333` → `#f6f6f7`/`#1c1c1e`)
- The app shell's header background (`(app)/layout.tsx`, `#333333` → `#1c1c1e`) and every `bg-[#f4f4f4]`
  page-wrapper div across the auth/public pages (→ `#f6f6f7`, matching the new CSS variable)
- `viewport.themeColor` in `layout.tsx` and `theme_color` in `manifest.ts` (`#333333` → `#1c1c1e`) — these
  drive the Android Chrome address-bar tint and the PWA splash/task-switcher chrome; leaving them on the old
  color while the header changed would have visibly mismatched the two
`src/lib/email/templates.ts`'s one inline `background: #f4f4f4` (the login short-code email block) was
deliberately left untouched — email client rendering is a separate concern from the web app's own theme and
wasn't part of this pass.

**V2 (mobile bottom-tab-bar + safe-area + responsive tables)**: `Nav` (`components/layout/nav.tsx`) is now
desktop-only (`hidden sm:flex`); a new `MobileTabBar` (`components/layout/mobile-tab-bar.tsx`) renders the
same 1-4 permission-filtered items below `sm:` (640px, this codebase's only breakpoint — reused rather than
inventing a new one). Both share item-list/active-route logic via `src/lib/nav-items.ts`
(`getNavItems`/`getActiveNavHref`) so the two nav variants can never drift apart. `viewport.viewportFit` is
`'cover'` in `src/app/layout.tsx` (required for `env(safe-area-inset-*)` to resolve to anything but `0px`
anywhere, including inside the standalone iOS PWA's already-active `black-translucent` status bar) —
this applies globally, so `.pt-safe`/`.pb-safe-tabbar`/`.pb-content-safe` (globals.css, all with an explicit
`, 0px` fallback) pad not just `(app)/layout.tsx`'s header and `<main>`, but also every `(auth)/*` page and
`drohnen-schnell/[token]`'s own wrapper `<div>`, since those don't share `(app)/layout.tsx` and would
otherwise sit under the notch/status bar once `viewport-fit=cover` took effect. `<Footer/>` is hidden below
`sm:` at its `(app)/layout.tsx` call site only (not inside the shared `Footer` component itself), so the
auth pages that also render it keep showing it.

Coordinated z-index scheme, since the new fixed tab bar sits permanently on top of page content and could
otherwise let taps reach through elements meant to block them: tab bar `z-30` < profile dropdown
(`profile-menu.tsx`) `z-40` < calendar's full-screen event-detail modal (`calendar-view.tsx`) `z-50`.

The three tables that previously only degraded via `overflow-x-auto` on narrow screens (Drohnengruppe flight
table, Benutzerverwaltung, News list) got a mobile card-fallback view added, following the exact pattern
already established by `event-list-view.tsx`: the same already-computed/filtered array feeds both a
`sm:hidden` card list and a `hidden sm:block` table, so the two views can't diverge. Benutzerverwaltung's
desktop click-to-sort column headers have no card equivalent, so a `sm:hidden` sort control (a `<select>`
of columns + a direction-toggle button) was added, wired to the exact same `sortKey`/`sortDir`/`toggleSort`
state the table already used.

While testing V2, an unrelated pre-existing bug was found and deliberately left unfixed (flagged as a
separate follow-up instead): the profile dropdown (name/bell icon in the header) doesn't open on click,
confirmed present on the code from before V2 too — see `profile-menu.tsx` if picking that up.

**V3 (Mobile-Brief.md)**: `MobileTabBar`'s grid-column fix and the header/`ProfileMenu` restructure
(single-row bar, initials avatar, Abmelden moved into the dropdown) described under "Kalender V3" and
"Shared: Mobile header context" above are part of this same pass — grouped there since they were driven
by and shipped together with Kalender's mobile rework, even though `MobileTabBar`/`ProfileMenu`/the header
are shared app-wide, not Kalender-specific. Verification note: this pass's interactive pieces (the collapsing
title's `IntersectionObserver`, the filter button's `useEffect`-driven registration into the header, click
handlers generally) could only be checked via computed-style/DOM-structure inspection of the server-rendered
HTML, not live interaction — the browser automation tool available at the time attached no React fiber to
any DOM node on this page (confirmed via `__reactFiber$`/`__reactContainer$` key lookups finding none
anywhere in the document, and a raw `.click()` on an existing, unrelated, already-working button producing no
className change), meaning it never hydrates client-side JS in this environment. This matches the same
click-testing limitation already noted during the V2 mobile-nav work above, now confirmed to be a
harness-wide gap rather than specific to one component.
