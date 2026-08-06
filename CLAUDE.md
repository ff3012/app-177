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
the codebase, see "System Check" below for why) · `qrcode` for server-side dashboard/token QR generation ·
`sharp` for compositing the WASTL district-status overlay GIFs onto the basemap (see "WASTL proxy" under
Dashboard Feuerwehrhaus below) · `cmdk` (via shadcn's `command` component) for the "Admin für"
searchable multi-select in `UserFormSheet` (see Benutzerverwaltung-Brief.md under Verwaltung below) ·
`node-ical` for parsing external .ics feeds for the Kalender module's read-only import sync (see
"Externer ICS-Kalenderimport" below - `ical-generator`, listed above, is output-only and unrelated) ·
`google-auth-library` for the Google-Calendar-Rückschreiben write side (see "Google-Kalender-
Rückschreiben" below) - only the lean auth/JWT-signing package, not the full `googleapis` client,
same "SDK only where real cryptography is involved" reasoning as `@aws-sdk/client-s3` above.

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
- `Organization.nummer` is the official Niederösterreichische Landesfeuerwehr-Nummer (`String`, required,
  `@unique`) — added specifically so future modules have a stable, human-meaningful identifier to reference a
  Feuerwehr/das AFKDO by, instead of the opaque `cuid()` `id`. Values: AFKDO Purkersdorf `17700`, Gablitz
  `17701`, Mauerbach `17702`, Pressbaum `17703`, Purkersdorf `17704`, Rekawinkel `17706`, Steinbach `17707`,
  Tullnerbach `17708`, Tullnerbach-Irenental `17709`, Wolfsgraben `17711` — note the gaps at `17705`/`17710`
  (numbers assigned to Feuerwehren outside this Abschnitt, not a data-entry omission). `prisma/seed.ts`'s
  `FEUERWEHR_NAMEN` carries `{name, nummer}` pairs (not just names) and its `upsert`s now actually set
  `nummer` (and `shortName`) in the `update` branch too, not just `create` — unlike the original seed, which
  used `update: {}` everywhere since it only ever needed to be idempotent, not to backfill a newly added
  field into already-existing rows. `seed.ts` remains the only code path that creates an `Organization` (no
  admin UI for it yet), so `nummer` being required doesn't need any other call site touched. Migration
  `20260810090000_organization_nummer` adds the column nullable, backfills the 10 existing rows by matching
  `name` (not `shortName` — `name` is the `@unique` column and the one guaranteed stable, e.g. `'FF Gablitz'`
  not `'Gablitz'`), then tightens to `NOT NULL` + `UNIQUE` in the same migration file — the standard safe
  sequence for adding a required column to a non-empty table, so `prisma migrate deploy` can run it
  unattended in one shot on both a fresh database and the existing production one.
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
- **Weiterer echter Bug aus derselben v3/v4-Ursache (gefunden nach einem Nutzerbericht: "Dienstgrade-Dropdown
  kann nicht ausgewählt werden")**: `npx shadcn add` generiert für Radix-Popup-Inhalte (`select.tsx`,
  `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`) Klassen wie `max-h-(--radix-select-content-available-height)`
  und `origin-(--radix-select-content-transform-origin)` — Tailwind **v4**s neue Kurzform, eine CSS-Variable
  direkt in runden statt eckigen Klammern zu referenzieren, ohne `var(...)`. Tailwind v3.4.19 kennt diese
  Syntax nicht; empirisch mit `npx tailwindcss -i ... --config tailwind.config.ts` gegen ein Test-HTML
  verifiziert (derselbe Verifikationsweg wie beim `data-checked:`-Fund oben): die Klasse erzeugt unter v3
  **gar keine Regel**, `max-height`/`transform-origin`/`width`/`height`/`min-width` bleiben unbounded/unset.
  Bei den meisten Radix-Popups (wenige Einträge, z. B. Rolle/Status-Filter oder das Row-Actions-Dropdown)
  blieb das unbemerkt, weil der Inhalt ohnehin in den Viewport passt — bei der 46-Einträge-Dienstgradliste
  im `UserFormSheet` sprengte das fehlende `max-height`/`overflow-y-auto`-Zusammenspiel jedoch die
  Panelgröße: das Dropdown öffnete sich (Radix rendert den Portal-Inhalt clientseitig ungeachtet der
  fehlenden CSS-Regel), aber ohne Höhenbegrenzung/Scroll ragte ein Großteil der Liste außerhalb des
  sichtbaren Viewports und war damit faktisch nicht anklickbar — genau das gemeldete Symptom. Gefixt durch
  Ersetzen der v4-Kurzform durch die v3-taugliche Arbitrary-Value-Syntax mit explizitem `var(...)`
  (`max-h-[var(--radix-select-content-available-height)]` etc.) an allen 6 betroffenen Stellen in den 4
  genannten Dateien — vorher/nachher per Tailwind-CLI-Kompilierung gegenübergestellt (Regel fehlte komplett →
  erzeugt jetzt `max-height: var(--radix-select-content-available-height)` korrekt). Da dieses
  Browser-Automatisierungs-Sandbox React clientseitig nie hydratisiert (derselbe bereits dokumentierte,
  session-übergreifende Befund — `__reactFiber$`-Lookup findet nirgends etwas, auch nicht nach direkter
  `?edit=<id>`-Navigation), war ein echtes Klick-Nachstellen des Dropdowns hier nicht möglich; die Behebung
  stützt sich stattdessen vollständig auf die empirische Tailwind-Kompilierungsprüfung, nicht auf einen
  Browser-Repro. `outline-hidden` (select.tsx/popover.tsx) und `not-data-[variant=destructive]:focus:**:...`
  (select.tsx, `**:`-Deszendenten-Variante) sind ebenfalls v4-only und erzeugen ebenso keine Regel, wurden
  aber bewusst **nicht** angefasst — rein kosmetisch (Fokus-Outline bzw. Fokus-Textfarbe), exakt dieselbe
  Abwägung wie beim ursprünglichen `tooltip.tsx`-Fund weiter oben.
- `tailwind.config.ts` braucht `import tailwindcssAnimate from 'tailwindcss-animate'` statt
  `require('tailwindcss-animate')` im `plugins`-Array — dieses Next-15-Setup lädt `tailwind.config.ts` in
  einem Kontext, in dem `require` zur Laufzeit nicht definiert ist (`ReferenceError: require is not defined`),
  nur `import`/ESM funktioniert.
- shadcn-Komponenten installiert (in `src/components/ui/`, eigene Dateinamen, keine Kollision mit den
  bestehenden Handbau-Dateien dort): `table`, `badge`, `button`, `input`, `select`, `switch`, `dialog`,
  `sheet`, `dropdown-menu`, `tabs`, `tooltip`, `skeleton`, `alert-dialog`, `separator`, `checkbox`,
  `popover`, `command` (+ dessen Abhängigkeiten `input-group`/`textarea`, aktuell ungenutzt aber von der
  CLI mitgeneriert). `command` bringt `cmdk` als neue Abhängigkeit mit - für "Admin für" in
  `UserFormSheet` (siehe Benutzerverwaltung-Brief.md unten). Dieselbe v3-Inkompatibilität wie beim
  ursprünglichen Verwaltung-Umbau trat erneut auf (`data-open:`/`data-closed:` in `popover.tsx`,
  `data-selected:` in `command.tsx` - jeweils per `grep` gegen `node_modules/@radix-ui/react-popover`/
  `node_modules/cmdk` auf den tatsächlich gesetzten Attributwert verifiziert, nicht geraten - Radix setzt
  `data-state="open"|"closed"`, cmdk setzt `data-selected="true"|"false"` als String, nicht als reine
  Präsenz), auf dieselbe Art gefixt (`data-[state=open]:` etc., `data-[selected=true]:`). Ein paar weitere
  rein kosmetische v4-only-Utility-Klassen in diesen beiden neuen Dateien (`rounded-xl!`,
  `*:data-[slot=...]:pl-2!`, `**:[[cmdk-group-heading]]:...`) wurden bewusst NICHT gepatcht - exakt
  dieselbe Abwägung wie beim ursprünglichen `tooltip.tsx`-Fall: sie erzeugen unter v3 einfach keine
  zusätzliche Regel, kein Build-Fehler, nur eine minimal weniger präzise Ecke/Innenabstand.
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
trigger a live DB query + Mailjet API call + external NTP fetch just to paint three status dots.
**Updated since "Meine Feuerwehr" (Module 4, see below)**: the shared layout's gate is no longer
`isSiteAdmin`-only — it also lets in any Feuerwehr-Admin — so a new Site-Admin-only page can no longer rely
solely on that gate and must add its own `if (!isSiteAdmin(user)) notFound()`, same as the four original
pages now do. `AdminSidebarNav`/`AdminMobileTabs`'s `ITEMS` are also no longer a static array — add a new
page by (1) adding the explicit `isSiteAdmin` check (or the relevant permission check, if it should also be
reachable by Feuerwehr-Admins) to the page itself, (2) adding one entry to `getAdminNavItems()` in
`src/lib/admin/nav-items.ts`, gated by whichever permission function fits.

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
- **Atemschutzgeräteträger-Zuweisung** (`UserFormSheet`, Person section, next to `phone`): a plain
  `istAtemschutzgeraeteTraeger` `Switch`, mirroring `isActive`'s row styling — this is where the boolean
  "IS this person an Atemschutzgeräteträger" gets set now (moved out of Heimatfeuerwehr, see Module 4 above);
  `userSchema`/`parseUserFormData` carry it, `createUser`/`updateUser` persist it directly on `User`. The
  three Untersuchung/Gültig-bis/Finnentest date fields and the AKTIV/expiry overview remain exclusively in
  `/admin/heimatfeuerwehr` (`AtemschutzEditDialog` no longer has a traeger toggle at all — it only shows/edits
  the three dates, and that page's members-Query now filters to `istAtemschutzgeraeteTraeger: true`, so a
  non-Träger member simply doesn't appear in that table anymore, instead of showing dashes).
- **Benutzerverwaltung: Feuerwehr-Admin-Scoping** — a later round opened this page up to plain Feuerwehr-Admins
  (previously `isSiteAdmin`-only, see the "Security hardening" note in Module 4 above), so a Feuerwehr-Admin
  can see/edit/create users of their **own** Heimat-Feuerwehr/Feuerwehren without needing the
  Abschnittskommando-Admin right — mirroring how `/admin/heimatfeuerwehr` already worked. New permission
  functions in `lib/auth/permissions.ts`: `canManageUsersFor(user, organizationId)` (identical rule to
  `canManageHeimatfeuerwehrFor` — Site-Admin or Admin of that org — given its own name for readability at
  Benutzerverwaltung call sites, since the rule could diverge later) and `canAccessUserManagementAdmin(user)`
  (nav/page visibility, same shape as `canAccessHeimatfeuerwehrAdmin`). `admin/benutzer/page.tsx`'s own gate
  changed from `isSiteAdmin` to `canAccessUserManagementAdmin`, and for a non-site-admin both the `users`
  query (`homeOrganizationId: { in: user.feuerwehrAdminOrgIds }`) and the `organizations` list passed down
  (same `{ in: ... }` filter) are scoped — the latter is what actually enforces "a Feuerwehr-Admin can only
  create/move users into their own Feuerwehr and can only grant 'Admin für' on their own Feuerwehr", since
  `UserFormSheet`'s Heimat-Feuerwehr `<Select>` and "Admin für" checkboxes are built directly from that array,
  offering no other org as an option in the first place. Every Server Action in `admin/benutzer/actions.ts`
  (`createUser`/`updateUser`/`deleteUser`/`setUserActive`/`sendPasswordResetEmailToUser`/`bulkSetActive`/
  `bulkSetHomeOrganization`) independently re-checks `canManageUsersFor` against every affected user's (and,
  for create/update/bulk-move, the target) `homeOrganizationId` — the scoped UI is a convenience, not the
  security boundary, same "never trust that the page-level check ran" philosophy already used elsewhere in
  this codebase (e.g. the QR quick-register token). A new `canGrantAdminFor` helper additionally guards
  `adminOrgIds` so a Feuerwehr-Admin can't grant "Admin für" on a Feuerwehr they don't manage via a direct
  Server Action call, even though the UI checkbox list already excludes that option. **Only a full
  Abschnittskommando-Admin (`isSiteAdmin`) still sees/manages every Feuerwehr's users** — this is enforced by
  `canManageUsersFor`/`canManageHeimatfeuerwehrFor` unconditionally returning `true` for a site admin
  regardless of `feuerwehrAdminOrgIds`. The Excel Export/Import links and routes
  (`/admin/benutzer/export`/`/admin/benutzer/import`) stayed **`isSiteAdmin`-only** — not scoped, hidden
  entirely from a plain Feuerwehr-Admin's UI (`UserManagementSection`'s new `isFullAdmin` prop) rather than
  built out to a per-org export, since a bulk cross-Feuerwehr spreadsheet feature wasn't part of this ask.
  Verified directly (not just type-checked): synthetic Feuerwehr-only-admin/site-admin/plain-member
  `SessionUser` objects run through `canManageUsersFor`/`canAccessUserManagementAdmin` produced exactly the
  expected true/false matrix (own org yes, other org no, site admin always yes, plain member never).

**Benutzerverwaltung-Brief.md ("Benutzer bearbeiten"-Sheet, Claude Design)** — a follow-up mockup-driven
rework of `UserFormSheet` specifically (the table/filters/bulk-actions from Verwaltung-Brief.md Phase 3-6
are untouched), imported the same way as the Dashboard Feuerwehrhaus brief earlier in this file: a
Claude Design project read via the `DesignSync` MCP tool's `list_files`/`get_file` methods (works for any
project the user can read, not only ones under the tool's own "design-system" writable-project model its
description emphasizes) rather than a browser/WebFetch flow.

- **Zwei neue Zeitstempel**: `User.lastLoginAt`/`User.passwordChangedAt` (both nullable, additive
  migration `20260802190718_user_last_login_password_changed_at`) - deliberately **not** backfilled from
  `createdAt` for existing users; an invented value is worse than "unknown". `lastLoginAt` is written in
  `auth.config.ts`'s `jwt` callback's `if (user)` branch (this branch, per Auth.js's own convention, only
  runs on an actual fresh sign-in - every other request hits the "no fresh login" branch just below it that
  re-fetches permissions instead) via a fire-and-forget `prisma.user.updateMany(...).catch(...)` - no
  `select`, no `await`, so a slow/failed write can never add latency to or block a login, matching the
  brief's explicit "darf die Anmeldung nie blockieren." `passwordChangedAt` is set in all three places a
  password can actually change: `aktivieren/[token]/actions.ts` (first-time setup),
  `passwort-zuruecksetzen/[token]/actions.ts` (reset-link), and `profile/actions.ts`'s `changePassword`
  (self-service). `src/lib/format.ts`'s new `formatRelativeDate(date, {fallback})` is the single formatter
  for both - always computed server-side pinned to `Europe/Vienna` (`Intl`/`toLocaleDateString` with an
  explicit `timeZone`, never a bare client-side `toLocaleDateString`, which would produce a hydration
  warning if server/browser clocks ever ran in different zones) - returns `{label, title}`: `label` is the
  short "heute HH:mm"/"gestern HH:mm"/"vor N Tagen"(≤7)/`DD.MM.YYYY`(older)/fallback(null) string for
  display, `title` the full `DD.MM.YYYY, HH:mm` for a tooltip. A same-file `isOlderThanMonths(date, n)`
  helper mutes the new "Zuletzt aktiv" table column once a login is >12 months stale. Both were verified
  with a standalone script against several offsets (today/yesterday/3d/7d/8d/60d, and the 12-month-mute
  boundary) rather than only type-checked, since neither depends on any harness-blocked client interaction.
- **Kein Admin-gesetztes Klartext-Passwort mehr**: `userSchema`/`parseUserFormData` lost their `password`
  field entirely, and `updateUser` no longer has the `...(data.password ? {passwordHash: ...} : {})`
  branch - satisfies the brief's own acceptance criterion "kein Weg mehr, über den ein Admin ein Passwort im
  Klartext setzen kann." In its place, edit mode's Zugang section shows a "Passwort" row with a
  "Reset-Mail senden" button (`variant="outline"`) instead of an input, behind an `AlertDialog` confirm,
  reusing the **existing** `sendPasswordResetEmailToUser` action unchanged in its core (already
  `canManageUsersFor`-scoped from the earlier Feuerwehr-Admin-Scoping round above) - two things were added
  to that action for this brief specifically: a rate limit (`prisma.passwordToken.count` of
  `PASSWORD_RESET`-purpose rows created in the last hour for that user, ≥3 blocks - deliberately a **shared**
  budget with the separate self-service "Passwort vergessen" flow rather than a second, independent counter,
  since both ultimately just create the same kind of token/email; verified against 0/2/3-tokens-in-window
  and an out-of-window old token via a direct script against the local DB, not just read for correctness) and
  a `console.log` line recording who triggered it and when - a deliberate, explicit choice over adding a
  persisted audit column (`PasswordToken.triggeredByUserId` or similar), confirmed with the app owner rather
  than assumed. The button is disabled (with a `Tooltip` explaining why - "Zugang ist deaktiviert" /
  "Keine E-Mail-Adresse hinterlegt") when the live, not-yet-saved `isActive`/`email` form values say so, and
  goes into a 60-second client-only "Gesendet" cooldown after a successful send (against
  double-click-spam; the server-side hourly count is the real protection, this is just UX). The row's own
  "Zuletzt geändert"-line reads `passwordChangedAt` through the same `formatRelativeDate`.
- **Sheet-Geometrie**: the "Zugang aktiv" toggle moved out of the Zugang section into its own
  `bg-surface-sunken` strip directly under the header (edit mode only, matching its previous
  edit-mode-only visibility) - deliberately placed **outside** the scrolling `<form>` element entirely; this
  works because `handleSubmit` reads from react-hook-form's shared `control` state, not from native DOM
  form-traversal, so a `Controller`-registered field doesn't need to be a DOM descendant of `<form>` to be
  included in submission. The header itself dropped the old "X bearbeiten" title suffix (now just the
  person's name) and gained a subtitle line, edit mode only: `"{Heimat-Feuerwehr} · zuletzt angemeldet
  {formatRelativeDate(lastLoginAt).label}"`.
- **Feldpaarung (Person)**: Vorname/Nachname and Telefonnummer/Standesbuchnummer are now each a
  `grid-cols-1 sm:grid-cols-2` pair (stacking below the app's usual `sm:` breakpoint, matching the brief's
  own explicit "<640px" reference) instead of four full-width rows.
- **"Admin für" Mehrfachauswahl**: `src/components/admin/admin-org-multiselect.tsx`
  (`AdminOrgMultiSelect`) replaces the checkbox list with a `Popover`+`Command` combobox - closed state is a
  button styled as an input showing removable chips (`bg-brand-subtle` pills with an `×`) or a
  "Keine Adminrechte" placeholder; open state adds a search input, a "N von M ausgewählt"/"Auswahl leeren"
  status row, and a scrollable, keyboard-navigable list. Deliberately renders its own left-aligned checkbox
  square per row instead of relying on `CommandItem`'s built-in right-side checkmark
  (`group-data-[checked=true]/command-item:opacity-100`, which needs a consumer-set `data-checked` this
  component never sets and stays permanently hidden) - cmdk's own `data-selected` tracks keyboard-hover
  highlighting only, not "is this org chosen," so the actual chosen-state visual has to come from this
  component's own `value` prop, not cmdk's internal state. `Command`'s `shouldFilter={false}` disables
  cmdk's built-in fuzzy filter in favor of a plain `.includes()` substring match against the search text,
  since the brief's own "Feuerwehr suchen" is a simple filter, not fuzzy search. Backspace on an empty
  search input removes the last chip (checked via the search state, not a DOM query). Keyboard/Escape
  behavior (tab to the trigger, Enter/Space opens, Escape closes and returns focus) all comes for free from
  Radix `Popover`'s own default behavior - no custom focus-management code was added for this, and none of
  Popover's defaults were overridden.
- **"Funktionen und Ausbildung"**: a new bordered block replacing the old standalone "Drohnengruppe"
  section - the Atemschutzgeräteträger toggle moved here from Person (a qualification, not a stable
  identity fact, per the brief), and Drohnengruppe itself is now a `SegmentedControl`
  (`src/components/ui/segmented-control.tsx`, "Kein · Mitglied · Admin") instead of a `RadioGroup` column.
  `SegmentedControl` deliberately builds directly on the raw `radix-ui` `RadioGroup` primitive rather than
  restyling the existing pre-styled `components/ui/radio-group.tsx` (whose round-dot look doesn't
  reasonably restyle into segments) - still a real ARIA radiogroup underneath (arrow-key navigation, one tab
  stop), just with fully custom segment markup instead of `radio-group.tsx`'s dot/label layout.
- **Footer "Benutzer löschen"**: a new red text-button on the footer's left (edit mode only), behind an
  `AlertDialog`, reusing `deleteUser` unchanged - previously this action only existed in the table's own
  row-menu (`user-row-actions.tsx`); the brief explicitly asked for it inside the sheet too, "den Weg gibt
  es im Sheet bisher gar nicht." Closes the sheet and refreshes the table on success, same as the row-menu's
  own delete flow.
- **Tabelle "Zuletzt aktiv"**: a new sortable column, `xl:`-visible like `E-Mail`/`Drohnengruppe`/`Push`
  next to it, reading `lastLoginAt` through `formatRelativeDate` (fallback `"–"`, per the brief's own
  wording for this specific spot - the Sheet header uses a different fallback, "noch nie angemeldet", for
  the same underlying field) and muted (`text-ink-faint`) via `isOlderThanMonths(…, 12)`.
- **Verification note, same harness-wide gap as every previous Verwaltung phase**: this browser-automation
  environment still doesn't hydrate client-side React on this page (`__reactFiber$` lookup on `document.body`
  found none after navigating with `?edit=<id>`, and the Sheet's own Portal-rendered content is correctly
  absent from the raw server HTML for the same reason - Radix Portals need a live client to mount, so a
  static SSR snapshot never includes them regardless of whether `initialEditUserId` seeded the right initial
  React state). This blocks any interactive check of the Popover/Command combobox, the segmented control,
  or either `AlertDialog`. What *was* verified directly against the live app instead: logging out and back
  in via the real (non-hydration-dependent, native-form) login flow and confirming `lastLoginAt` actually
  updates and renders correctly ("heute HH:mm") in the "Zuletzt aktiv" column; the reset-rate-limit's exact
  DB query logic (0/2/3-in-window counts, and that an out-of-window token is correctly excluded) against the
  real local database; and `formatRelativeDate`/`isOlderThanMonths`'s date math against several concrete
  offsets - plus a clean `tsc`/production build across the whole change.

**Dienstgrad (NÖ-Feuerwehr-Rangdropdown)** — a follow-up request to add rank (Dienstgrad) to
Benutzerverwaltung, always shown/edited as its official short form only (e.g. `LM`, `HBI`, `ABI`, `FM`,
`SB`, `EOBI`), backed by a new central lookup table rather than a free-text field, so the value can never
drift from the NÖ Landesfeuerwehrverband's actual rank names.

- **`Dienstgrad` model** (`prisma/schema.prisma`): `kurzform` (`@unique`, the only form ever displayed),
  `bezeichnung` (full name, shown nowhere in the UI today - kept purely as a documentation/future-proofing
  field on the row itself), `kategorie` (`DienstgradKategorie` enum: `MANNSCHAFT`/`CHARGE`/`OFFIZIER`/
  `VERWALTUNG`/`SACHBEARBEITER`/`SONDERDIENSTGRAD`/`EHRENDIENSTGRAD` - informational grouping only, no
  permission logic attached), `sortOrder` (`@unique`, the actual professional hierarchy within each
  category, not alphabetical - lowest rank first). `User.dienstgradId` is nullable (existing members have
  none set) with `onDelete` left at Prisma's default (`Restrict`) since there's no legitimate reason to ever
  delete a row from this reference table. **The 46-row seed list was researched, not invented**: fetched via
  `WebSearch`/`WebFetch` against Wikipedia's "Dienstgrade der Feuerwehr in Österreich" (Niederösterreich-
  specific section) and AustriaWiki/austria-forum.org's mirror of the same article, cross-checked between
  both sources for the base Mannschafts-/Chargen-/Offiziers-/Verwaltungs-/
  Sachbearbeiter-/Sonderdienstgrade list, then a **second, targeted search specifically for the
  Ehrendienstgrade** (honorary ranks for retired officers who keep an "Ehren-"-prefixed title, e.g. the
  user's own example `EOBI` = Ehren-Oberbrandinspektor) since the first source didn't cover those at all.
  The full researched draft (all 46 entries, grouped by category) was presented back to the user for
  confirmation before seeding - specifically flagging that `EOBI` was initially missing from the first
  source - rather than committing invented or half-verified official rank names for a real Austrian
  volunteer fire brigade organization's actual personnel records. The user confirmed the full scope
  (including the rarely-used Verwaltungs-/Sonderdienstgrade categories) explicitly.
- **`prisma/seed.ts`**: `DIENSTGRADE` array + an idempotent `upsert`-by-`kurzform` loop, same pattern as the
  existing `DROHNEN_NAMEN` seeding just above it - safe to re-run against a live production database via the
  already-documented one-off `db seed` command (see "Stack" section) without touching any other data.
- **UI**: `UserFormSheet`'s Person section first row is now a 3-column
  `grid-cols-1 sm:grid-cols-3` (`[Dienstgrad] [Vorname] [Nachname]`, was a 2-column
  Vorname/Nachname pair) with a `Select` sourced from the `dienstgrade` list (now threaded as a new prop
  through `page.tsx` → `UserManagementSection` → `UserFormSheet`, alongside `organizations`) - a `"NONE"`
  sentinel value maps to/from the field's real empty-string state, since Radix `Select.Item` can't take a
  literal empty-string `value`. Every `SelectItem`'s rendered text is the bare `kurzform` only (not
  `"kurzform – bezeichnung"`) in both the closed trigger and the open list, deliberately - Radix's
  `Select.Value` always mirrors whichever `SelectItem`'s text was registered for the current value (it
  can't show different text in the trigger vs. the list), and showing the full name only in the list would
  have meant abandoning "nur die Kurzform" for that one surface. A new "Dienstgrad" column (always visible,
  not `xl:`-gated, since rank is core identifying info alongside the name next to it) was added to the
  desktop table - and, since roster convention is to show rank directly in front of a name, the mobile
  `UserCard` also gained a small muted `{kurzform} ` prefix before the name text, reusing the same
  `UserRow.dienstgrad` string both places read from.
- Verified: the full 46-row seed against the local database (correct count, correct `kurzform`/`bezeichnung`/
  `kategorie` for a sample), and the actual rendered table column showing the correct short form for a real
  user after setting `dienstgradId` directly in the database - the Sheet's own `Select` interaction itself
  falls under the same already-documented harness-wide hydration gap as every other Sheet control in this
  module and couldn't be click-tested directly.

**Benutzerstatus: Inaktiv vs. Deaktiviert (Atemschutz/Drohnengruppe-Sichtbarkeit)** — a real reported bug:
a brand-new user, created but not yet clicked through their activation link, is `isActive: false` exactly
like an explicitly deactivated user - both collapsed onto the same boolean, so the Atemschutz table
(`/admin/heimatfeuerwehr`) and the Drohnengruppe pilot-picker/flight-eligibility check both hid a never-
activated member just as thoroughly as a genuinely deactivated one, making it impossible to pre-enter their
Atemschutzuntersuchung/Finnentest or record a drone flight they'd already flown before the account existed
in this app.

- **`src/lib/auth/user-status.ts`** (new) introduces a derived, non-persisted 3-state distinction rather
  than a new DB column: `getUserStatus(user): 'AKTIV' | 'INAKTIV' | 'DEAKTIVIERT'` reads `isActive` +
  `passwordChangedAt` - `AKTIV` if `isActive`, else `DEAKTIVIERT` if `passwordChangedAt` is set (the account
  was activated/reset/self-changed at some point, so `isActive: false` means an admin deliberately turned it
  off), else `INAKTIV` (never activated at all). `passwordChangedAt` is set exactly once by activation/
  password-reset/self-service-change and **never cleared again** (not even by another deactivation), so this
  derivation stays correct across any number of activate/deactivate cycles. Deliberately not a new enum
  column: the existing `isActive` boolean still drives login and every other existing check unchanged
  (nothing about auth gating changed), and the three-state read is only needed at a handful of display/
  filter call sites. Accepted, rare edge case: an admin who deactivates a user who has *never* activated at
  all sees them still labeled "Inaktiv" rather than "Deaktiviert" (both still correctly hidden from nothing,
  since only `DEAKTIVIERT` is ever hidden - see below) - judged acceptable rather than adding a dedicated
  `activatedAt` column for a scenario with no real consequence.
- **`NOT_DEACTIVATED_WHERE`** (same file) is the companion Prisma `where`-fragment for the opposite
  direction - which users an admin-facing "who's an eligible/active member" query should still include:
  `{ OR: [{ isActive: true }, { isActive: false, passwordChangedAt: null }] }`, i.e. everyone except
  `DEAKTIVIERT`. Applied at exactly the three places that previously read a plain `isActive: true`:
  the Atemschutz-Tabelle's member query (`admin/heimatfeuerwehr/page.tsx`), and both
  `listDrohnengruppeMembers()` and `isEligiblePilot()` (`src/lib/drone/members.ts`) - the latter two are
  shared by the flight-registration pilot picker, the write-time eligibility re-check in
  `createFlight`/`updateFlight`, the 90-Tage-Report, and `/admin/drohnen`'s "Mitglieder · 90-Tage-Status"
  table, so broadening them once fixes all four consistently rather than only the flight form (confirmed
  as the desired behavior with the app owner rather than assumed - a never-activated Drohnengruppe member's
  compliance is legitimately worth tracking in those reports too, not just recordable). Saving Atemschutz
  dates itself already had no `isActive` gate of its own (`updateAtemschutzStatus` only checks
  `canManageHeimatfeuerwehrFor`) - the bug was purely that the page never surfaced the row/edit-trigger to
  click in the first place, so widening the query alone was the complete fix for that half of the report.
- **Benutzerverwaltung UI**: the previously 2-state Aktiv/Inaktiv badge (`UserCard` mobile card, desktop
  table row) and the Status filter `Select` (2 options, `SimpleFilter`'s `JA`/`NEIN`) both become genuinely
  3-state, driven by `getUserStatus()` - green/amber/red (`success`/`warning`/`danger` tokens, the same
  amber already used for "läuft bald ab" elsewhere in Heimatfeuerwehr) for Aktiv/Inaktiv/Deaktiviert
  respectively. A new `StatusFilter` type (`'ALLE' | UserStatus`) replaces `SimpleFilter` for the status
  filter specifically - `SimpleFilter` (`ALLE`/`JA`/`NEIN`) stays exactly as before for the unrelated Rolle
  filter. The existing single "Zugang aktiv" on/off toggle in `UserFormSheet` is **unchanged** - no new
  control was added; which of the two "off" labels shows is purely a consequence of whether that user had
  ever been active before, decided deliberately with the app owner over adding a manual status picker. The
  Excel export's "Status" column (previously a bug-for-bug-identical `isActive ? 'Aktiv' : 'Deaktiviert'`,
  silently mislabeling a never-activated user as "Deaktiviert") now reads the same three labels via
  `getUserStatus()` too, for consistency with the on-screen badge.
- **Data retention, unchanged/confirmed rather than built**: a `DEAKTIVIERT` user's `atemschutz*` fields
  (plain columns on `User`) and `DroneFlight` rows (`onDelete` unrelated to `User.isActive`) were never
  touched by any of this - deactivating only ever changes visibility via the query filters above, never the
  data itself, and reactivating (`isActive: true` again) makes both reappear exactly as they were. Only
  actually deleting the `User` row cascades away that history, which was already true before this change and
  needed no new code.
- Verified directly against the real dev database (not just read for correctness): a standalone script
  created a never-activated Atemschutzgeräteträger + Drohnengruppe-Pilot, confirmed they appear in the
  Atemschutz query, `listDrohnengruppeMembers()`, and `isEligiblePilot()`; added a real Untersuchungsdatum
  and recorded a real past `DroneFlight` for them; simulated activation-then-deactivation and confirmed the
  derived status flips to `DEAKTIVIERT` and the same three checks now correctly exclude them while the
  Atemschutz date and the flight row both remain in the database untouched; then reactivated and confirmed
  visibility returns. 17/17 assertions passed. Also confirmed live in the browser (this session's rendered
  HTML, not just the underlying query): three real users (never-activated, currently active, previously-
  active-then-deactivated) each show the correct one of the three distinct badge labels/colors in both the
  mobile card list and the desktop table.

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

### Module 4: Meine Feuerwehr

`/meine-feuerwehr` ("Meine Feuerwehr" = the user's own `homeOrganizationId`) is unconditionally visible to
every logged-in user (added to `getNavItems` right after Kalender, same as Kalender itself — no permission
check needed since every user has a home org) and shows two things: their own Atemschutz status, and their
home Feuerwehr's vehicle fleet ("Fuhrpark") for borrowing.

- **Atemschutz** (`User.istAtemschutzgeraeteTraeger`/`atemschutzUntersuchungAm`/`atemschutzGueltigBis`/
  `atemschutzFinnentestAm`, plain nullable fields on `User` — same pattern as `stbNr`/`phone`, not a separate
  1:1 table, since they're single-valued not historical) is **read-only** on this page — members only have
  "Einsicht" (view). Editing is split across two places by data-ownership, not by page (a later, deliberate
  restructuring of the original single-dialog design): **whether** someone is an Atemschutzgeräteträger at
  all (`istAtemschutzgeraeteTraeger`) is now a plain toggle in Benutzerverwaltung's `UserFormSheet` (Person
  section, alongside `isActive`) — it's a basic user attribute, like `stbNr`, not Heimatfeuerwehr-specific
  data — while the three **date** fields (Untersuchung/Gültig-bis/Finnentest) plus the AKTIV/expiry overview
  stay in Verwaltung → Heimatfeuerwehr (see below), since that's operational compliance data a Feuerwehr's
  own Atemschutz-Sachbearbeiter manages. `atemschutzGueltigBis` is a genuinely separate, explicitly-stored field from
  `atemschutzUntersuchungAm` — **not** computed as "+5 years" on read — because a doctor can set a shorter
  validity than the 5-year default; `src/lib/heimatfeuerwehr/atemschutz-status.ts`'s `isUntersuchungActive()`
  just compares the stored `atemschutzGueltigBis` against now. `atemschutzFinnentestAm` by contrast has no
  override field at all: the Finnentest's 1-year validity is a fixed, non-negotiable rule per the brief, so
  `isFinnentestActive()`/`getFinnentestCutoff()` compute it the same way `ninety-day-rule.ts` computes drone
  compliance (today minus a fixed window) — this file is deliberately modeled on that existing pattern.
- **Fuhrpark / vehicle booking**: `Vehicle` (per-organization fleet, `taktischeBezeichnung`/`kennzeichen`
  `@unique`/`marke`/`typ`/`isActive`) and `VehicleBooking` (`vehicleId`/`userId`/`startsAt`/`endsAt`) are new
  models. The member page lists the home org's active vehicles, each with its own upcoming bookings shown
  inline (date/time + borrower's name) *before* the user books — this is what satisfies "zeige an wenn es
  bereits gebucht ist und von wem". `/meine-feuerwehr/buchen` is the booking form (own page, matching the
  `/drohnen/neu`-style convention rather than an inline card): one shared `<input type="date">` plus two
  independent `Time15MinSelect` dropdowns (Start/Ende) — a **new** component
  (`src/components/ui/time-15min-select.tsx`) factored out of `DateTime15MinInput`'s existing
  `TIME_OPTIONS` generation, since here two time selects share one date instead of each field bundling its
  own date+time. `createVehicleBooking` (`meine-feuerwehr/actions.ts`) re-validates the overlap server-side
  via `src/lib/heimatfeuerwehr/vehicle-availability.ts`'s `findOverlappingBooking()` — a plain interval
  overlap query (`existingStart < newEnd AND existingEnd > newStart`, verified with six manual overlap/
  adjacent/separate-day cases against real seeded data before shipping) — a Postgres exclusion constraint
  can't be expressed through Prisma, so this is enforced in application code only, same recheck-at-write-time
  philosophy as `isEligiblePilot`/`isActiveDrone` in the Drohnengruppe module. Cancelling a booking
  (`cancelVehicleBooking`) is allowed for the booking's own `userId` or anyone who can manage that vehicle's
  organization (`canManageVehicleBooking`) — mirrors `canManageFlight`'s "own record or module admin" shape.
- **`VehicleBooking.details`** (added later, nullable `String`): a free-text field the borrower must fill in
  (`vehicleBookingSchema` requires it, 1–500 chars) describing the purpose of the booking, but **admin-only
  to read back** — it's deliberately absent from `/meine-feuerwehr`'s own "Meine Buchungen" list (the
  borrower themselves never sees it again after submitting) and from the public dashboard kiosk
  (`lib/dashboard/data.ts`'s query only ever `select`s vehicle name/borrower name, never `details`) and from
  the linked `Event`'s title/description (still just `"Fahrzeug: {taktischeBezeichnung} ({Name})"`, unchanged
  — putting it there would leak it to every Kalender viewer). Only shown as a "Details" column on the two
  genuinely admin-only surfaces: `/admin/heimatfeuerwehr`'s "Fahrzeug-Buchungen" table (all bookings for the
  selected org) and `/admin/heimatfeuerwehr/fahrzeug/[vehicleId]`'s Buchungshistorie — both already
  `canManageHeimatfeuerwehrFor`-gated pages, so no new permission check was needed, just a new column.
  Nullable at the DB level (existing bookings have no value) with the "required" rule enforced only in
  `vehicleBookingSchema`/`BookingForm`, the same nullable-but-form-required pattern used elsewhere in this
  codebase rather than a DB `NOT NULL` that would need a backfill value for old rows. Verified live: a
  booking inserted with a distinctive `details` string appears verbatim on both admin surfaces, while
  `/meine-feuerwehr`'s own booking list (viewed as the same user who created it) shows the booking but never
  that string.

**Verwaltung → Heimatfeuerwehr** (`/admin/heimatfeuerwehr`) is where the Fuhrpark and Atemschutz data actually
get edited — a new admin page inside the existing `/admin/*` Verwaltung shell, using the same shadcn
Table/Badge/Dialog toolkit as the other admin pages (this is Verwaltung, not a member page, so it follows
that philosophy, not the hand-rolled one `/meine-feuerwehr` itself uses).

- **New permission tier**: unlike every other admin page, this one must be visible to *both*
  Abschnittskommando-Admins *and* plain Feuerwehr-Admins (an org-level `Membership` with role `ADMIN`, no
  Abschnittskommando admin membership required) — the brief explicitly asked for this. `canManageHeimatfeuerwehrFor(user, organizationId)` (`lib/auth/permissions.ts`) is `isSiteAdmin(user) ||
  canManageEventsFor(user, organizationId)` — deliberately a **new**, separately-named function rather than
  reusing `canManageEventsFor` directly, because the rule genuinely differs: `canManageEventsFor` was written
  so a site admin *without* an explicit per-org `Membership` cannot manage that org's events (see its own
  comment), but here a site admin must always have access regardless. `canAccessHeimatfeuerwehrAdmin(user)`
  (`isSiteAdmin(user) || user.feuerwehrAdminOrgIds.length > 0`) gates module/nav visibility. The page itself
  resolves which org(s) the current user may manage into an `?org=<id>`-driven selector (site admins choose
  from every Feuerwehr; a plain Feuerwehr-Admin only ever sees their own).
- **Security hardening this required**: `admin/layout.tsx`'s gate was previously `isSiteAdmin`-only for *all*
  of `/admin/*`; it's now `canAccessHeimatfeuerwehrAdmin` (which already includes `isSiteAdmin`), so a plain
  Feuerwehr-Admin can get past the layout. Since the four pre-existing admin pages
  (`benutzer`/`drohnen`/`email`/`status`) had never needed their own guard — they relied entirely on that
  layout — each of them now has an explicit `if (!isSiteAdmin(user)) notFound()` of its own, a small but
  real security-hardening side effect of adding this module, not an incidental cleanup. `getAdminNavItems(user)` (new, `src/lib/admin/nav-items.ts`, mirrors `getNavItems` in the app-wide
  `lib/nav-items.ts`) replaces the previously-hardcoded `ITEMS` array in both `AdminSidebarNav` and
  `AdminMobileTabs` — at the time this module shipped, Benutzerverwaltung/Drohnengruppe/E-Mail/Status all
  stayed `isSiteAdmin`-only, Heimatfeuerwehr was the only one additionally shown to any
  `canAccessHeimatfeuerwehrAdmin`. Verified directly (not just type-checked): a synthetic Feuerwehr-only-admin
  `SessionUser` object run through `getAdminNavItems` returned **only** `['Heimatfeuerwehr']`, and
  `canManageHeimatfeuerwehrFor` correctly returned `false` for an org that admin didn't manage — confirming
  the scoping wasn't just theoretically correct but actually behaved as designed. **Benutzerverwaltung was
  opened up to Feuerwehr-Admins in a later round** (see "Benutzerverwaltung: Feuerwehr-Admin-Scoping" under
  the Benutzerverwaltung section below) — its own explicit gate changed from `isSiteAdmin` to a new
  `canAccessUserManagementAdmin`, and `getAdminNavItems` now shows it to any Feuerwehr-Admin too;
  Drohnengruppe/E-Mail/Status remain `isSiteAdmin`-only as described here.
- Editing Atemschutz status uses the same "auto-suggest but don't overwrite a manually-touched value" pattern
  as `event-form.tsx`'s Start→Ende sync: changing "Untersuchung am" pre-fills "Gültig bis" as +5 years, but
  only until the admin edits "Gültig bis" directly — after that, further "Untersuchung am" changes never
  clobber it again (`AtemschutzEditDialog`'s `gueltigBisTouchedRef`).

**Heimatfeuerwehr V3** — a follow-up expansion (Excel export/import, an expiry-warning email, booking
history, and vehicle deletion), all requested and scoped in separate rounds after the base module shipped.

- **Unified 3-state expiry status**: the original `isUntersuchungActive`/`isFinnentestActive` booleans were
  replaced by a single `getExpiryStatus(expiryDate: Date | null): 'aktiv' | 'laeuft_bald_ab' | 'abgelaufen' |
  'keine_angabe'` (`ATEMSCHUTZ_WARNING_DAYS = 30`) — both Untersuchung (passing `atemschutzGueltigBis`
  directly) and Finnentest (passing a computed `getFinnentestExpiryDate(atemschutzFinnentestAm)` = that date
  + `FINNENTEST_WINDOW_DAYS`) now go through the same function, so the "läuft bald ab" rule can't drift
  between the two. Both `/meine-feuerwehr` and `/admin/heimatfeuerwehr`'s badges show all three colors
  (green/amber/red) — no new report page, per the app owner's explicit choice, just a third badge state in
  the tables that already existed.
- **Sachbearbeiter-scoped warning email, not global**: unlike every other notification in this codebase
  (`notifySystemCheckResult`, `notifyDroneFlightCreated` — one global `AppSettings` recipient each),
  the Atemschutz warning's recipient is a **per-organization** contact:
  `Organization.atemschutzSachbearbeiterEmail` (nullable, edited via a small form directly on
  `/admin/heimatfeuerwehr`, `setAtemschutzSachbearbeiter` in that page's `actions.ts` — a plain
  `prisma.organization.update`, not routed through `lib/settings.ts`, since that file is only for the
  singleton `AppSettings` row). This was a deliberate, explicit choice by the app owner over a global address
  or "send to every Feuerwehr-Admin" — each Feuerwehr designates its own Atemschutz contact person, who may
  not be an app admin at all. `checkAndNotifyAtemschutzWarnungen()`
  (`lib/heimatfeuerwehr/notify-atemschutz-warnung.ts`) therefore loops every `FEUERWEHR` org with a
  configured address (silently skipping the rest), builds one email per org listing only members with a
  `laeuft_bald_ab` Untersuchung or Finnentest, and wraps each org's send in its **own** try/catch — one
  Feuerwehr's Mailjet failure must not block the others' emails. `/api/cron/atemschutz-warnung` (GET,
  `CRON_SECRET`-gated — `/api/cron` is already a public prefix in `middleware.ts`, no change needed there) +
  `docker/atemschutz-warnung-email.sh` (daily 08:00 Vienna, documented in `docker/README.md`) mirror
  `/api/cron/system-check`'s exact wrapper-script shape. Verified live: seeded a member with a
  `laeuft_bald_ab` Untersuchung and a configured Sachbearbeiter address, hit the cron route directly, and
  confirmed via server logs that it correctly identified the org and attempted the send — the send itself
  failed on a local-network TLS issue (this dev machine, unrelated to the code — the same failure would hit
  any of this app's other Mailjet calls tested the same way here) and was caught exactly as designed, with
  the route still returning success.
- **Excel export/import — Fuhrpark gets both, Atemschutz export-only**: `lib/heimatfeuerwehr/
  vehicle-excel-columns.ts` and `.../atemschutz-excel-columns.ts` mirror `lib/admin/user-excel-columns.ts`'s
  shape exactly (shared header/key/width list; the vehicle one also splits out `VEHICLE_IMPORT_COLUMN_KEYS`
  the same way `USER_IMPORT_COLUMN_KEYS` does, so a re-uploaded export works as an import template
  unmodified). Both export routes (`fuhrpark-export`, `atemschutz-export`) are `?org=<id>`-scoped and
  `canManageHeimatfeuerwehrFor`-checked, unlike `/admin/benutzer/export` which has no such scoping since
  users aren't per-org data in the same way. The Atemschutz export has **no import counterpart** — a
  deliberate choice, confirmed with the app owner: bulk-editing safety-critical medical/compliance data via
  spreadsheet upload was judged too risky, so that data stays editable only one member at a time through
  `AtemschutzEditDialog`. Fuhrpark import (`fuhrpark-import/actions.ts`) duplicate-detects by `kennzeichen`
  alone (already `@unique`, simpler than the User importer's composite `stbNr`+`homeOrganizationId` key) and
  targets whichever org is selected on the page (unlike User import, which reads the destination org from a
  column per row, since a vehicle export is already single-org-scoped).
- **Buchungshistorie**: `admin/heimatfeuerwehr/fahrzeug/[vehicleId]/page.tsx` (linked from each Fuhrpark row's
  new "Historie" action) shows **every** booking for that vehicle, past and future — `/meine-feuerwehr`
  deliberately only ever queries upcoming ones (`endsAt: { gte: now }`), so this is a genuinely separate,
  admin-only query, not a filter toggle on the same data. It also shows a simple utilization figure: total
  booked hours in the last 90 days (`endsAt - startsAt` summed across bookings in that window) — verified
  live against a real 3-hour booking.
- **Fahrzeug löschen, blocked by any booking**: `deleteVehicle` (new) proactively counts
  `prisma.vehicleBooking.count({ where: { vehicleId } })` and refuses with a friendly, count-specific message
  if it's non-zero — checked explicitly *before* attempting the delete, rather than catching Prisma's FK
  constraint error the way `deleteUser` does, since Vehicle→VehicleBooking is a single simple 1:n relation
  and a proactive check guarantees the friendly message every time. This protects the booking-history feature
  above: deleting a vehicle would otherwise cascade-delete (`onDelete: Cascade`) its entire history. Verified
  live with a real vehicle pair — one with a booking (blocked, exact count in the message) and one without
  (deleted successfully). The three former inline row actions (Bearbeiten/Aktivieren-Deaktivieren) plus the
  two new ones (Historie/Löschen) are now a `DropdownMenu` in `vehicle-row-actions.tsx`, 1:1 the
  `user-row-actions.tsx` composition pattern from the Benutzerverwaltung — "Bearbeiten" passes a
  `DropdownMenuItem` (with `onSelect={(e) => e.preventDefault()}`) straight in as `VehicleFormDialog`'s
  `trigger` prop rather than duplicating its edit form, the same trigger-survives-a-closing-menu technique
  already used there for the "Löschen" `AlertDialogTrigger`.

**Heimatfeuerwehr V4** — a follow-up round driven by direct user feedback on the shipped V3 module (a
screenshot of `/meine-feuerwehr` marking the Fuhrpark section for removal, plus a live-tested, confirmed
report that Feuerwehr-only admins couldn't see the "Verwaltung" nav entry at all).

- **Compact Fuhrpark widget**: `/meine-feuerwehr`'s Fuhrpark section no longer renders every vehicle as its
  own card with an embedded upcoming-bookings list — it's now a single native `<select>` of the home org's
  active vehicles plus an "Ausborgen" submit button, `<form action="/meine-feuerwehr/buchen" method="get">`.
  A plain GET form was chosen deliberately over a client-side `<select>`-driven link: it needs no JS at all
  (works identically in this session's documented non-hydrating browser-automation environment) and the
  browser's own querystring-building does exactly what a client `onChange` handler would otherwise need to
  do by hand. `/meine-feuerwehr/buchen` now accepts `searchParams: Promise<{ vehicleId?: string }>`,
  validates the incoming id against the actually-fetched vehicle list (an invalid/foreign id is silently
  ignored, not trusted), and passes it to `BookingForm` as a new optional `initialVehicleId` prop that only
  overrides the form's default vehicle selection — Datum/Start/Ende are unaffected.
- **Vehicle bookings sync into the main Kalender as protected events**: `Event.vehicleBookingId` (nullable,
  `@unique`, `onDelete: SetNull`) links an `Event` 1:1 to the `VehicleBooking` it represents — its mere
  presence is the "this event is booking-managed" marker, no separate boolean needed.
  `createVehicleBooking` (`meine-feuerwehr/actions.ts`) now also creates a plain `ALLGEMEIN`,
  non-section-wide `Event` (title `"Fahrzeug: {taktischeBezeichnung} ({Name})"`, in the booking's own
  Feuerwehr) tagged with that id; `cancelVehicleBooking` looks the linked `Event` up via
  `vehicleBookingId` and deletes it first (only `if` it still exists — an accepted edge case in case an
  `Event` was ever removed independently of its booking, e.g. via Prisma Studio) before deleting the
  booking itself. This was a deliberate product decision, not an incidental side effect: the user explicitly
  asked for bookings to show up as ordinary calendar entries rather than a separate widget.
  `cancelVehicleBooking` gained a second, optional `redirectTo = '/meine-feuerwehr'` parameter specifically
  so `/admin/heimatfeuerwehr`'s own "all bookings" section (below) could reuse this exact function without
  being redirected to the member overview page after deleting someone *else's* booking — it passes
  `` `/admin/heimatfeuerwehr?org=${selectedOrgId}` `` instead, preserving which Feuerwehr was selected.
- **Booking-managed events are protected from normal editing** — the user explicitly overrode the simpler
  alternative (leave them freely editable like any other event) in favor of this stricter behavior.
  `kalender/page.tsx`'s `editable` flag gains `&& !event.vehicleBookingId`, which — since that one computed
  value already drives both `EventListView`'s double-click-to-edit shortcut and the FullCalendar
  `eventClick` handler's edit-vs-view branch — suppresses the dead-end edit navigation from `/kalender`
  itself. The event detail page (`kalender/[eventId]/page.tsx`) has its own, separate "Bearbeiten" link that
  needs the identical `!event.vehicleBookingId` condition alongside its `canManageEventsFor` check — it isn't
  fed by `kalender/page.tsx`'s `editable` flag, so it doesn't inherit that guard for free and must repeat it.
  `/kalender/[eventId]/bearbeiten` additionally checks `event.vehicleBookingId` directly and, if set, renders
  a blocking message ("Dieser Termin gehört zu einer Fahrzeug-Buchung...") with a link back to
  "Meine Feuerwehr" instead of `EventForm`/the delete button — placed *after* the existing
  `canManageEventsFor` check, so a user without edit rights still sees the generic permission message first.
  `updateEvent`/`deleteEvent` (`kalender/actions.ts`) got the identical guard server-side, consistent with
  this codebase's "every Server Action re-checks its own permissions" rule — a direct action call can't
  bypass the page-level block. **Reversed since V4 shipped**: RSVP ("Zusage") was originally left
  intentionally open on booking-managed events (only editing/deleting the event itself was blocked) — the
  app owner later asked for this to change after seeing it live: a vehicle-booking entry has no real
  concept of "Zugesagt/Abgesagt/Unklar", so `/kalender/[eventId]/page.tsx` now hides both the "Meine
  Zusage" widget (`EventRsvpButtons`) and the "Teilnehmerliste" section entirely when
  `event.vehicleBookingId` is set — not just visually de-emphasized, the whole `<div>` block for each is
  conditionally omitted. The rest of the detail page (Zeit/Organisation/Ort/Beschreibung, the vehicle icon
  elsewhere in the app) is unaffected. `setRsvp`/`sendEventPushNow` themselves were not touched — this is a
  page-level display change only, not a new permission guard (nothing stops a booking event's RSVP from
  being set via a direct action call, but the UI never offers it, matching this event type's actual
  semantics rather than adding a redundant server-side block for a path nothing in the UI reaches).
  Vehicle-booking events still flow into the same per-organization `.ics` calendar feed as any other event,
  with no special exclusion — there was never a reason to treat them differently there.
- **Visible icon on booking-managed events**: a new, small, shared `VehicleBookingIcon`
  (`components/calendar/vehicle-booking-icon.tsx`, hand-rolled inline SVG car silhouette, matching this
  codebase's "no icon library" convention) renders next to the title at all three places events are ever
  displayed — the FullCalendar month-grid chip (`renderEventContent` in `calendar-view.tsx`), `EventListView`'s
  desktop table row, and its mobile card — all three reading from one new `CalendarEventInput.isVehicleBooking`
  boolean so the three views can't drift apart, the same principle already established for `RsvpBadge`.
- **Admin: all vehicle bookings for a Feuerwehr in one place**: a third section on `/admin/heimatfeuerwehr`
  (alongside Fuhrpark and Atemschutz, not a separate sub-page — matching this page's existing single-page,
  multi-section shape) lists every `VehicleBooking` for the selected org, past and future, with vehicle,
  formatted date range, borrower's name, a Kommend/Vergangen status badge, and a "Löschen" action that
  reuses `cancelVehicleBooking` directly (imported via `@/app/(app)/meine-feuerwehr/actions`, the same
  cross-route-group Server-Action-import pattern already used elsewhere in this codebase, e.g.
  `admin/benutzer/actions` from `user-form-sheet.tsx`) rather than duplicating it — Heimatfeuerwehr-admins
  already have the right permission via `canManageVehicleBooking` inside that same function.
- **Bugfix, confirmed via live testing with a real account**: `src/lib/nav-items.ts`'s `getNavItems()`
  previously gated the whole "Verwaltung" nav entry on `isSiteAdmin(user)` alone, even though
  `lib/admin/nav-items.ts`'s *internal* Verwaltung sidebar/tabs had already been made correctly
  permission-aware for Feuerwehr-only admins in an earlier round — meaning a Feuerwehr-only admin could
  never even discover `/admin/heimatfeuerwehr` existed, despite already being allowed to use it once there.
  Fixed to `if (isSiteAdmin(user)) push /admin/benutzer; else if (canAccessHeimatfeuerwehrAdmin(user)) push
  /admin/heimatfeuerwehr` — site admins keep landing on the Benutzerverwaltung as before, Feuerwehr-only
  admins now land directly on the one Verwaltung page they're actually allowed to see. Verified against
  three synthetic `SessionUser` shapes (site admin / Feuerwehr-only admin / neither), not just type-checked.
- Verified live end-to-end against a real seeded vehicle/booking: the compact widget renders and its
  "Ausborgen" link carries the vehicle id through to the booking form; a booking created directly (mirroring
  what `createVehicleBooking` produces) appears in `/kalender`'s list view with the vehicle icon; its edit
  page shows the blocking message; `/admin/heimatfeuerwehr`'s new section lists it correctly scoped to the
  selected Feuerwehr; and deleting it from there removes both the `VehicleBooking` and its linked `Event`
  while redirecting back to the admin page (not `/meine-feuerwehr`) with the selected org preserved.

### Fahrzeug-Reservierungen: Freigabe-Workflow per E-Mail

A follow-up request renamed the borrowing flow ("Fahrzeug ausborgen" → "Fahrzeug Reservierungen",
"Ausborgen" buttons → "Reservieren") and added an optional per-Feuerwehr approval step: if
`Organization.fahrzeugReservierungEmail` is set, a new reservation no longer creates its calendar
entry immediately - it waits for an explicit Genehmigen/Ablehnen decision emailed to that address.

- **`VehicleBookingStatus` enum** (`OFFEN`/`GENEHMIGT`/`ABGELEHNT`) + `VehicleBooking.status`
  (`@default(GENEHMIGT)` at the DB level, so pre-existing rows stay valid and behaviorally unchanged)
  + `VehicleBooking.approvalToken` (nullable, `@unique`, a **raw** capability token like
  `DashboardToken.token` - not hashed like `PasswordToken`, since this is a low-stakes one-time action
  link, not an auth credential). `createVehicleBooking` (`meine-feuerwehr/actions.ts`) branches on
  whether the vehicle's organization has `fahrzeugReservierungEmail` set: unset → **unchanged legacy
  behavior**, immediately `GENEHMIGT` + linked `Event` created, no email; set → the booking is created
  `OFFEN` with a fresh `approvalToken`, **no `Event` yet**, and an approval-request email goes out
  instead (see below). This means an `OFFEN` (or `ABGELEHNT`) reservation simply has no `Event` row at
  all - it's automatically invisible everywhere the Kalender/Dashboard already only ever query `Event`,
  no extra filtering needed there.
- **Overlap check still blocks on `OFFEN`, only frees up on `ABGELEHNT`**:
  `findOverlappingBooking` (`lib/heimatfeuerwehr/vehicle-availability.ts`) gained `status: { not:
  'ABGELEHNT' }` - a still-pending reservation must keep blocking the same time slot for other members,
  or two people could get their overlapping requests approved independently before either approval
  resolves the conflict. Only a rejected reservation frees the vehicle back up. Verified directly (not
  just read for correctness): a real overlap query against a `GENEHMIGT` slot found it, the same query
  against an `ABGELEHNT` slot at a different time found nothing.
- **Two public, session-less routes** — `/fahrzeug-reservierung/genehmigen/[token]` and
  `/fahrzeug-reservierung/ablehnen/[token]` (new top-level segment, added to `middleware.ts`'s
  `PUBLIC_PATH_PREFIXES`, same reasoning as `/drohnen-schnell`/`/dashboard`: no session exists when a
  clicked email link opens on any device) - both render via one shared server component,
  `booking-decision-view.tsx`, parameterized by `mode`. **One click on the email link is enough** - the
  page's own GET request performs the Genehmigen/Ablehnen decision directly during render (no
  intermediate "Ja, bestätigen"-button/second click), by calling `decideVehicleBooking(token, decision)`
  (`lib/heimatfeuerwehr/vehicle-booking-decision.ts`) straight from `BookingDecisionView`'s server
  component body and rendering whatever `VehicleBookingDecisionOutcome` it returns
  (`invalid`/`already_decided`/`decided`, a discriminated union) - there is no form and no button on this
  page at all, only the resulting confirmation text. This is a **deliberate, explicit departure** from
  the "explicit click required, not auto-consumed on GET" pattern used everywhere else in this codebase
  for one-time links (`/login/token/[token]`, activation, password reset) - see the long comment on
  `decideVehicleBooking()` for the accepted tradeoff: an email link-scanner (Microsoft Safe Links,
  Mimecast, etc.) that auto-visits links could in theory trigger the decision itself before a human ever
  opens it. Judged acceptable here because this is a low-stakes internal approval action, not a password
  reset, and the requester explicitly asked for a single click to suffice.
  `decideVehicleBooking` is a plain, non-`'use server'` lib function (not a Server Action) precisely so
  it can be called directly from render - Server Actions are POST-triggered and would have needed a
  form/button, defeating the point. `approveVehicleBooking`/`rejectVehicleBooking` no longer exist; the
  whole decision (atomic status flip, conditional `Event` creation, result email) lives in this one
  function, called identically by both routes via the shared view component. **`revalidatePath()` is
  deliberately NOT called from `decideVehicleBooking`** - Next.js forbids calling it during a Server
  Component's render phase (`"used ... during render which is unsupported"`, a real crash hit and fixed
  while building this: the DB mutation had already committed successfully before the crash, confirmed via
  direct `psql` inspection, so only the trailing revalidation calls were the problem, not the core logic).
  Not needed anyway: `/meine-feuerwehr`, `/kalender`, and `/admin/heimatfeuerwehr` all render dynamically
  from the DB on every real navigation (fresh tab, external link, hard reload) - only an already-open,
  client-router-cached view could stay briefly stale until its own next load. A booking that's no longer
  `OFFEN` (already decided, or an invalid token) returns `already_decided`/`invalid` instead of
  re-processing - clicking a link twice, or the "other" link after a decision was already made, is
  harmless and shows the already-reached status rather than an error.
- **`lib/heimatfeuerwehr/notify-vehicle-booking.ts`**: `sendVehicleBookingApprovalRequest()` (to the
  configured Freigabe-Adresse, two literal `<a>` buttons styled inline, labelled exactly `GENEHMIGT` /
  `NICHT GENEHMIGT` per the request) and `sendVehicleBookingDecisionEmail()` (to the requester, **Cc**
  the Freigabe-Adresse so it also sees the outcome) - `sendEmail()` (`lib/email/mailjet.ts`) gained an
  optional `cc?: string[]` param for this, the first caller to need Cc at all. Both email sends are
  wrapped in try/catch at the call site (same "a Mailjet outage must never block the actual state
  change" precedent as `notify-flight-created.ts`) - the reservation itself, and the approve/reject
  decision, always succeed even if the email fails to send.
- **UI renames**: the Schnellzugriff-Kachel and `/meine-feuerwehr/buchen` heading read "Fahrzeug
  Reservierungen"; every "Ausborgen"/"Fahrzeug ausborgen" submit button reads "Reservieren"; "Meine
  Buchungen" → "Meine Reservierungen" (now also showing a status badge per row, and hiding the
  "Stornieren" button for `ABGELEHNT` rows - nothing left to cancel); the admin table and the
  per-vehicle history page read "Fahrzeug-Reservierungen"/"Reservierungshistorie" with "Reserviert von"
  instead of "Gebucht von", plus a real status badge (`Offen`/`Genehmigt`/`Abgelehnt`) alongside the
  existing Kommend/Vergangen distinction (shown together as e.g. "Genehmigt" + a small "Vergangen"
  label, only for already-`GENEHMIGT` rows in the past). The Kalender module's own edit-blocked
  messages ("Dieser Termin gehört zu einer Fahrzeug-Buchung...") and the shared `VehicleBookingIcon`'s
  `aria-label` were updated to "Fahrzeug-Reservierung" for consistency, since they describe the exact
  same underlying concept. `Vehicle`/`VehicleBooking` themselves keep their original Prisma model names
  unchanged - this was a user-facing copy change only, not a schema/identifier rename, to avoid an
  unnecessary migration and touching far more files for zero user-visible benefit.
- **Verified end-to-end live** (not just type-checked): inserted two real `OFFEN` `VehicleBooking` rows
  with known tokens, opened both decision pages in the actual browser, and used a real `computer` click
  (not a simulated call) on each - the genehmigen click flipped status to `GENEHMIGT` and created the
  correctly-titled linked `Event`; the ablehnen click flipped status to `ABGELEHNT` and created no
  `Event`. Both pages then correctly showed "bereits entschieden" with the right status label on reload.
  The overlap-exclusion query was verified directly against this same test data. Test rows cleaned up
  afterward. Email delivery itself was not verified live (Mailjet isn't configured in this dev
  environment) - the send call sites are try/catch-wrapped for exactly this kind of failure, and the
  booking/decision logic was confirmed correct independent of whether the email actually goes out.
- **Bugfix history (real user report: "E-Mail wird immer doppelt geschickt - sowohl bei Genehmigt als
  auch bei Abgelehnt")**: the original two-step design (a confirm page with a "Ja, bestätigen"-button
  Server Action) read the booking (`status !== 'OFFEN'` check) and wrote the new status as two separate
  steps - a doubled tap on the confirm button could pass the read-check twice before either write landed,
  sending two result emails. A first fix applied the TOCTOU guard below to those Server Actions, but the
  user reported the duplicate still happened - at which point the user separately asked for the two-step
  design to become one-click (see above), which removed the vulnerable confirm-button step entirely
  rather than patching it further. The atomic guard itself carried over unchanged into
  `decideVehicleBooking`, the exact same pattern as `consumeToken()` (`lib/auth/tokens.ts`) already
  established for one-time tokens: `prisma.vehicleBooking.updateMany({ where: { approvalToken, status:
  'OFFEN' }, data: { status: decision } })`, checking `claimed.count === 0` (already decided/invalid/lost
  the race) before doing anything further - only the winning call creates the `Event`/sends the result
  email. **Re-verified directly against the current `decideVehicleBooking` function** (not just the
  removed Server Actions the original fix targeted): firing two `decideVehicleBooking(token, 'GENEHMIGT')`
  calls at the identical row via `Promise.all` resolves to exactly one `{kind: 'decided'}` and one
  `{kind: 'already_decided'}`, with exactly one linked `Event` row created - confirming the guard holds
  in the new one-click code path too.
- **Ablehnen-Grund (follow-up)**: Ablehnen alone got a deliberate, partial reversal of the one-click
  design above - a request to let the Fahrzeug-Admin explain *why* a reservation can't be granted.
  `VehicleBooking.rejectionReason` (nullable `String`, migration `20260815090000_vehicle_booking_
  rejection_reason`) stores it, set only on `ABGELEHNT` (always `null` on `GENEHMIGT`).
  `previewVehicleBookingRejection(token)` (`vehicle-booking-decision.ts`) is a new, read-only sibling of
  `decideVehicleBooking()` - it loads the booking and returns `invalid`/`already_decided` (unchanged
  from before) or a new `pending` case (booking still `OFFEN`) without mutating anything.
  `booking-decision-view.tsx`'s ablehnen branch now calls this preview first: `pending` renders a plain
  page-level form (a `<textarea name="reason">`, optional, 500-char capped both client-side
  `maxLength` and server-side `.slice()`) instead of immediately deciding; `invalid`/`already_decided`
  render the exact same result view Genehmigen already used (a small `renderOutcome()` helper shared by
  both branches). Submitting posts to a new Server Action, `submitRejection` (`app/fahrzeug-
  reservierung/ablehnen/[token]/actions.ts`), which calls `decideVehicleBooking(token, 'ABGELEHNT',
  reason)` (now takes an optional third parameter) and then `redirect()`s back to the same ablehnen
  URL - the reload shows the `already_decided` outcome with the stored reason. Genehmigen is
  completely unaffected: it still calls `decideVehicleBooking(token, 'GENEHMIGT')` directly from
  render, no dialog, one click. The reason is surfaced to the person who reaches it: in
  `sendVehicleBookingDecisionEmail`'s result mail (a `Grund: ...` line, ABGELEHNT-only), on
  `/meine-feuerwehr`'s "Meine Reservierungen" (under the status badge), and on `/admin/
  heimatfeuerwehr`'s Fahrzeug-Reservierungen table (under the status cell) - so it isn't write-only,
  visible only in an email that could get lost. Verified live end-to-end: submitted a real rejection
  through the actual form (not a scripted call), confirmed via direct DB read that `status`/
  `rejectionReason` landed correctly and zero `Event` rows were created, and confirmed the reason
  renders correctly on both the reload confirmation page and `/meine-feuerwehr`; Genehmigen's one-click
  path re-tested unchanged in the same session.
- **E-Mail-Signatur entfernt (follow-up)**: both vehicle-booking emails
  (`sendVehicleBookingApprovalRequest`/`sendVehicleBookingDecisionEmail`, both text and HTML parts)
  dropped their trailing "Abschnittsfeuerwehrkommando Purkersdorf" line at the app owner's explicit
  request - scoped to just these two templates, not the app-wide email sign-off convention described
  under "Email" below (those templates are untouched).

### Startbildschirm & mobile Navigation (Startbildschirm-Brief.md)

A follow-up mobile-only rework (imported via the same Claude Design `DesignSync`-MCP flow as the earlier
Benutzerverwaltung/Dashboard briefs): `/meine-feuerwehr` becomes the post-login landing page and a real
"does anything need my attention" dashboard, and the mobile bottom nav shrinks to a fixed 3-tab bar with the
home org's crest as the center "home" button. Scoped to `< 640px` (this app's only breakpoint, `sm:` - the
brief itself said "< 768px" but that's treated the same "approximate figure, not a new breakpoint" way
Kalender V3 already established); desktop is untouched except where a server-side redirect target had no
way to vary by viewport (see "Login-Redirect" below).

- **Post-login landing page**: all six hardcoded `/kalender` redirect targets (`login/actions.ts` ×2,
  `login/page.tsx` ×2, `aktivieren/[token]/actions.ts`, `passwort-zuruecksetzen/[token]/actions.ts`) plus
  the root `src/app/page.tsx` and the email-token "Anmeldung erfolgreich" link changed to `/meine-feuerwehr`.
  This is a **universal** change (desktop lands there too) since a Server Action can't branch a redirect by
  viewport width - there is no separate "old desktop /meine-feuerwehr" preserved; the new dashboard content
  below renders at every width (it degrades fine into the app's usual `max-w-5xl` column), only the
  nav/header work described next is genuinely mobile-only.
- **"Zu erledigen" / "Als Nächstes"** (`src/components/home/home-todo-list.tsx`, `HomeTodoList`, a Client
  Component): three todo sources, exactly as the brief's own table specifies - (1) an own-org-or-abschnittsweit
  event within the next 14 days with no `TerminZusage` row yet ("Offene Rückmeldung"), (2) Atemschutz
  Untersuchung/Finnentest expiring within a **60-day** window (a new, separate, more lenient threshold than
  the existing `ATEMSCHUTZ_WARNING_DAYS = 30` that drives the amber badges everywhere else in
  Heimatfeuerwehr - computed inline in `meine-feuerwehr/page.tsx`'s `buildAtemschutzTodo`, deliberately not
  folded into `atemschutz-status.ts`'s shared 30-day constant), (3) the 90-Tage-Regel not yet met for a
  Drohnengruppe member (reusing `getNinetyDayCutoff`/`meetsNinetyDayRule` unchanged). If none apply, the
  whole "Zu erledigen" block is omitted entirely (no placeholder) and the page starts at "Als Nächstes" -
  verified live against a freshly-reseeded dev DB with zero events/flights.
  - **Inline Zusagen/Absagen, no page reload**: the RSVP-type todo card calls the existing `setRsvp` Server
    Action directly (no note field, no "Unklar" - just the two buttons the brief's mockup shows, 44px each,
    1:1 grid) and **optimistically** moves the card into "Als Nächstes" the instant a button is tapped;
    `HomeTodoList` keeps a local `responded` map that overrides the server-provided event's status purely
    client-side, merges it back into the upcoming pool (re-sorted by date, sliced to 2), and rolls the
    override back out + shows a `sonner` toast if `setRsvp` returns an error. The server only ever sends the
    RSVP-eligible events already split into `rsvpTodos` (needs a response) vs. `upcomingPool` (top-4 buffer,
    not just top-2, so a moved card always has enough real data to merge against) - a todo event never
    appears in both arrays from the server, only the client's optimistic override can move one across.
  - **Kommandant-Variante**: for any candidate event whose organization the viewer manages
    (`canManageEventsFor`), the card shows the team's RSVP tally (`{n} zugesagt · {n} offen`, "offen" = active
    home-org member count minus zugesagt, not tracking Abgesagt/Unklar separately - matches the brief
    mockup's own two-figure "14 zugesagt · 9 offen") plus a "Details" link, instead of the Zusagen/Absagen
    buttons - applies uniformly whether the card would otherwise be in "Zu erledigen" or "Als Nächstes",
    since the brief's own wording ("die Terminkarte...statt der eigenen Zu-/Absage-Buttons") reads as one
    shared card variant, not two different rules for the two sections.
- **Schnellzugriffe**: two link-tiles, "Fahrzeug ausborgen" (→ `/meine-feuerwehr/buchen`, status line "N von
  M heute frei" from a single batched `VehicleBooking` query against today's date range - no per-vehicle
  N+1) and, only for Drohnengruppe members, "Flug registrieren" (→ `/drohnen/neu`, status either "90 Tage
  erfüllt" or "N von 3 Flügen"). One tile only (no empty second grid cell) for non-drone members.
- **"Stand der Wehr"**: gated on `canManageHeimatfeuerwehrFor(user, user.homeOrganizationId)` specifically -
  i.e. an admin (site or Feuerwehr) of their **own** home org, not any org they happen to administer. Shows
  active member count, an Atemschutz-expiring count (reusing the existing 30-day `getExpiryStatus` - the
  same figure the Heimatfeuerwehr admin table's amber badges already use, not a new threshold), and a
  Fuhrpark line (vehicles booked today / bookings this calendar month) linking to `/admin/heimatfeuerwehr`.
  Absent entirely (not shown-but-empty) for a plain member.
- **Wappen (Organization crest)**: new nullable `Organization.wappenImageData`/`wappenImageMimeType`
  (`Bytes`/`String`, Bytes-in-Postgres like `DroneDocument`/`FacebookPostImage` - a handful of small logo
  images, no reason for a Docker volume), uploaded per-Feuerwehr on `/admin/heimatfeuerwehr` (new
  "Wappen (Startbildschirm)" card, `WappenUploadForm` + `setOrganizationWappen`/`removeOrganizationWappen` in
  that page's `actions.ts`, same upload-Server-Action shape as `admin/drohnen`'s PDF upload). Served via a
  new session-gated (not in `middleware.ts`'s public prefixes, but no extra permission check beyond being
  logged in - a crest is not sensitive) `GET /api/organization/[organizationId]/wappen` route, 404 if unset.
  `(app)/layout.tsx`'s `homeOrganization` query was narrowed to an explicit `select` (previously a
  select-less `findUnique`) specifically so the potentially-large `wappenImageData` blob is never pulled
  into every single page navigation just to read `wappenImageMimeType`'s presence. No wappen set → the
  mobile tab bar's center button shows a neutral hand-rolled fallback shield icon
  (`components/layout/wappen-fallback-icon.tsx`) - never another Feuerwehr's crest, never the old blanket
  `/wappen-afkdo.png` (which stays exactly where it already was: login page, desktop header, dashboard kiosk,
  drohnen-schnell - all untouched, this per-org crest is additive, not a replacement of that AFKDO mark).
- **Mobile tab bar rebuilt from scratch** (`components/layout/mobile-tab-bar.tsx`): no longer built from the
  shared, permission-driven `getNavItems()`/`nav-items.ts` list that desktop `<Nav>` still uses unchanged -
  a hardcoded, fixed 3-column grid (`grid-cols-3`, `h-[86px]`) instead: Kalender (left) · Wappen-Home (center,
  a 46px white circle floated `-mt-4` above the bar, `Meine Feuerwehr` label, links to `/meine-feuerwehr`) ·
  Drohnengruppe (right, only rendered when `canViewDroneModule`, otherwise an empty `aria-hidden` cell so the
  center button stays visually centered rather than the grid collapsing to 2 columns). News and Verwaltung -
  previously riding along in the same permission-driven list on mobile too - needed new homes since the
  brief's tab bar has no room for them: Verwaltung moved into a new header pill (see below); News moved into
  `ProfileMenu`'s dropdown as a plain `sm:hidden` link (`canManageNews`-gated, new prop) alongside the
  existing mobile-only Abmelden - desktop keeps reaching both exactly as before, through the unchanged `<Nav>`.
- **Header restructure** (`(app)/layout.tsx`): the mobile-only small AFKDO crest `<img>` that used to sit at
  the far left is gone entirely (the brief: "Das Wappen ist hier nicht mehr - es sitzt in der Tab-Bar").
  `MobileHeaderTitleSlot`'s `fallback` prop is now a per-user computed label - `"Feuerwehr {shortName}"` for
  a Feuerwehr home org (e.g. "Feuerwehr Wolfsgraben", never the org's full `name` with "Freiwillige
  Feuerwehr..."), or just the shortName/name as-is for an AFKDO home org (a "Feuerwehr AFKDO Purkersdorf"
  label would have read wrong) - the slot's own crossfade-with-the-page's-CollapsingPageTitle mechanism
  (Kalender V3) is completely unchanged, only what it shows before a page pushes its own title. Bumped that
  slot's font size from `text-sm` (14px) to the brief's explicit `text-[17px]` - a shared value, so this
  also affects the crossfaded page-title text, not just the fallback. A new `Verwaltung` pill
  (`sm:hidden`, 30px tall, `border-[#4a4a4e]`, links to `/admin/benutzer` for a site admin or
  `/admin/heimatfeuerwehr` otherwise - same target resolution `getNavItems()` already used) sits in the
  header's right-hand cluster, gated on `canAccessHeimatfeuerwehrAdmin(user)`, matching the brief's own
  "sichtbar nur wenn Adminrechte, serverseitig geprüft" requirement exactly (no client-side hiding).
- **Verified live** against the running dev server (not just `tsc`/`build`, which were also both clean):
  `/meine-feuerwehr` renders the full greeting/todo/quick-access/Stand-der-Wehr stack correctly for the
  seeded site admin (whose home org is the AFKDO, hence the un-prefixed header label and the empty third tab
  slot since that account isn't a Drohnengruppe member); the 3-column tab bar's exact `grid-template-columns`
  (three equal 125px columns at 375px width), `86px` height, and `46px`/`-16px margin-top` center circle were
  all confirmed via `getComputedStyle`; the new wappen route was round-tripped end-to-end (upload a real PNG
  directly into `Organization.wappenImageData` via `psql`, fetch `/api/organization/.../wappen` from the
  live authenticated tab and confirm 200 + correct `Content-Type` + correct byte count, then confirm the
  admin page's "Entfernen" button appears, then clean the test row back to `NULL`); and the responsive
  cross-over itself was confirmed both directions via `getBoundingClientRect()` (not `getComputedStyle`
  alone, which - as a bare check - doesn't reflect an invisible ancestor collapsing a `display:flex` child to
  zero width) at 375px vs. 1280px: the new header pill and mobile tab bar render at mobile width and
  collapse to zero width at desktop width, while desktop `<Nav>`'s own separate "Verwaltung" link and the
  footer do the exact opposite. What remains unverifiable for the same already-documented, harness-wide
  reason as every earlier Verwaltung/Kalender mobile pass: the RSVP buttons' actual optimistic-move-on-click
  interaction, the wappen upload form's real file-input submit, and the ProfileMenu dropdown's News link
  (React state never attaches in this browser-automation session, so `useState`-gated JSX - the dropdown's
  `{open && (...)}`, `HomeTodoList`'s `responded` map - never mounts in a static DOM snapshot regardless of
  the underlying logic's correctness).
- **Bugfix (real user report, screenshot showed "Zusagen"/"Absagen" on a `Fahrzeug: MTF-BUS1 (...)`
  card)**: the initial version didn't carry the Kalender module's own "vehicle-booking events have no
  RSVP concept" rule into this new "Zu erledigen" query at all, so any event created via
  `createVehicleBooking` (`Event.vehicleBookingId` set) that fell inside the 14-day window and had no
  `TerminZusage` row (which, correctly, it never does - nobody RSVPs to a booking) was misclassified as an
  "Offene Rückmeldung" needing a response, same as a real Übung/Einsatz. `HomeEventCardData` gained an
  `isVehicleBooking` flag; `meine-feuerwehr/page.tsx` now excludes such events from `rsvpTodos` entirely
  (they still show up in "Als Nächstes" as read-only entries, since a vehicle booking is still a real
  future occupation of the calendar - just never as a to-do) and skips the Kommandant tally computation for
  them too (same reasoning: no Zusagen to tally). `HomeTodoList`'s "Als Nächstes" row reuses the existing,
  already-shared `VehicleBookingIcon` (`components/calendar/vehicle-booking-icon.tsx`) next to the title for
  such entries, the same icon the Kalender grid/list/mobile-card already show - so this is now consistent
  everywhere the app renders a vehicle-booking event, not a fourth, diverging spot. Verified live by
  reproducing the exact reported scenario (a `Vehicle`/`VehicleBooking`/linked `Event` inserted directly via
  `psql`, 3 days out) alongside a plain event with no RSVP 5 days out: after the fix, "Zu erledigen" shows a
  count of 1 (the plain event only, correctly rendered with the Kommandant tally variant since the test
  account manages that org) and the vehicle-booking event appears only in "Als Nächstes" with the car icon
  and a plain chevron - no Zusagen/Absagen anywhere for it. Test rows cleaned up afterward.

### Module 5: Dashboard Feuerwehrhaus (GitHub Issue #8)

A public, token-authenticated, TV/kiosk dashboard screen (`src/app/dashboard/[token]/page.tsx`) meant to be
displayed on a Windows PC in the firehouse, Chrome in fullscreen: kommende Termine, ausgeborgte Fahrzeuge
(30 Tage), the WASTL Niederösterreich fire-status map, a Facebook feed, and a QR code linking to the app.
Built from a fully-specified external design brief (Claude Design `Dashboard-Brief.md` + a `.dc.html`
mockup), not derived from scratch — the spec at
`docs/superpowers/specs/2026-08-02-dashboard-feuerwehrhaus-design.md` and the plan at
`docs/superpowers/plans/2026-08-02-dashboard-feuerwehrhaus-plan.md` carry the full rationale.

- **Route + token model, deliberately NOT the `drohnen-schnell` pattern**: `DashboardToken` (new model:
  `token` unique, `organizationId`, `createdById`, `expiresAt`/`lastUsedAt`/`revokedAt` all nullable) is a
  genuinely separate model from the Drohnengruppe QR-Schnellerfassung's single `AppSettings.droneQuickRegisterToken`
  field, because multiple tokens per Feuerwehr with independent expiry/revocation don't fit that
  singleton's shape. `src/app/dashboard/[token]/page.tsx` (`dynamic = 'force-dynamic'`, `revalidate = 0`,
  outside the `(app)` route group, `'/dashboard'` added to `middleware.ts`'s `PUBLIC_PATH_PREFIXES`) calls
  `getValidDashboardToken()` (`src/lib/dashboard/token.ts`) and — unlike `drohnen-schnell`, which always
  returns 200 even for an invalid token — calls `notFound()` on anything invalid/expired/revoked, per this
  feature's explicit requirement ("kein Hinweis auf die Existenz der Seite"). A valid visit calls
  `touchDashboardTokenUsage()` to update `lastUsedAt` — the one write this otherwise strictly read-only
  route performs, tracked separately from the read-only validity check so a read (e.g. from the admin
  page) never falsifies "zuletzt verwendet".
- **Deliberately minimal data exposure**: `src/lib/dashboard/data.ts`'s `getDashboardEvents()` and
  `getDashboardVehicleBookings()` select only display fields — no RSVP status, no phone numbers, no
  Atemschutz data — matching the explicit privacy requirement for a screen anyone who knows the link/QR
  can view. `getDashboardEvents()` deliberately does NOT filter out the Drohnengruppe category the way the
  real Kalender query does (`canViewDroneModule`) — there is no per-viewer session on this public screen,
  so it shows every category for the org/Abschnitt uniformly.
- **Fluid layout, no fixed pixel sizing anywhere**: the whole page is `clamp()` + CSS grid, drawn against a
  1920×1080 reference but built to reflow correctly from 1366×768 up through 4K and portrait — no
  `transform: scale()`, no fixed px width/height on the root. Six shared typography roles live as
  `.dash-*` utility classes in `globals.css` (`.dash-clock`, `.dash-section-label`, etc.) rather than
  repeating long `clamp()` values at every call site. Three custom Tailwind breakpoints
  (`dash-sm: 1200px`, `dash-md: 1600px`, `dash-lg: 2400px`, added to `tailwind.config.ts`'s `theme.extend.screens`)
  drive the column-count changes the `clamp()` values alone can't express. **A real defect was caught and
  fixed during this build**: the original design brief's own typography table specified
  `.dash-section-label` as `clamp(12px, 0.8vw, 19px)` while ALSO stating elsewhere, unconditionally, that no
  text may render under 14px on this screen — a live check at 1600×900/1680×1050 (ordinary, common
  resolutions, not an edge case) showed every section label actually rendering at exactly 12px. The 12px
  value was simply wrong (an arithmetic slip in the source brief); the fix was raising the floor to
  `clamp(14px, 0.8vw, 19px)`, resolving the self-contradiction in the brief's favor of its own explicit,
  repeated "14px is bindend" rule.
- **`HeightFittedList`** (`src/components/dashboard/height-fitted-list.tsx`) is the "mehr Einträge auf
  einem großen Display, nicht größere Schrift" mechanism: for Termine (≤10) and Fahrzeugbuchungen (≤8) the
  server itself already caps what it sends; for Facebook, the server actually sends every cached post
  within the 90-day window uncapped, and the ≤6 figure is purely this component's own `maxVisible` prop —
  a client-side display limit, not a query limit. In all three cases this client component renders every
  item it's handed once on mount (so their real heights can be measured), then uses `useLayoutEffect` +
  `ResizeObserver` to compute how many actually fit the container and re-renders showing only that many —
  the initial "show everything, then clip" pass happens inside `useLayoutEffect`, which runs synchronously
  before the browser paints, so the momentarily-full state is never actually visible. The fit calculation
  reads the container's actual `gap` (via `getComputedStyle`) and adds it between measured items — the flex
  container uses `gap-[11px]`, and summing only `offsetHeight` without that gap would undercount used space
  and let one row through that doesn't actually fit, silently clipped by the container's own
  `overflow-hidden`. Deliberate limitation: once clipped, hidden items are no longer in the DOM at all (not
  just `display:none`), so a *later* growth of the container can't reveal more items without a fresh full
  render — acceptable here because the kiosk never live-resizes (§ Betrieb below), only hard-reloads.
- **QR code, generated server-side, not hand-drawn or externally hosted**: `src/lib/dashboard/qr-code.ts`'s
  `generateQrCodeDataUri(url)` uses the `qrcode` npm package (new dependency — this is the first QR-code
  generation ever added to this app; the Drohnengruppe's QR-Schnellerfassung link has never rendered an
  actual QR image in-app, only shown the raw link/copy button) to build an SVG, base64-encoded as a `data:`
  URI — no extra route handler needed since it's generated directly inside the Server Component.
  `generateAppQrCodeDataUri()` is a thin wrapper around it for the app-install URL (`APP_URL`, read from
  `process.env.AUTH_URL` the same way `buildDashboardLink` in `admin/heimatfeuerwehr/page.tsx` does, falling
  back to the literal production URL if unset), used only by the public dashboard page's own QR card. The
  admin page's per-token "QR anzeigen" `<details>` disclosure does **not** reuse that same code for every
  row — each dashboard token gets its own QR code encoding that token's actual dashboard link
  (`generateQrCodeDataUri(buildDashboardLink(token.token))`, precomputed per token before the JSX return),
  since printing the app-install QR next to a specific token's "QR anzeigen" control would send whoever
  scans it to the login page instead of that token's kiosk dashboard — a real bug caught in final review,
  not a hypothetical.
- **WASTL proxy** (`src/app/api/wastl/overview/route.ts`), `unstable_cache`-wrapped exactly like
  `getAdminSidebarStatus()` in `lib/system/system-check.ts` (120s `revalidate`), with a `WastlImageCache`
  (Bytes-in-Postgres, singleton row) fallback so a live-fetch failure never blanks the card — it serves the
  last successful image plus an `X-Wastl-Stale-Since` header instead. Two real things were only discoverable
  by actually fetching the live page during this build (not guessable in advance): (1) the real page has
  **two** `<img>` tags per overview image — a stale, commented-out S3-mirror copy first, the real
  relative-URL one second — so the scrape targets the specific `id="IMGB_ALL"` element, comments stripped
  first, rather than a naive first-match; (2) `unstable_cache`'s return value is JSON-serialized internally,
  so a raw `Buffer` returned from the cached function deserializes on a cache-hit as a plain
  `{type:'Buffer', data:[...]}` object, not a real `Buffer` — this crashed Prisma's `upsert` ("Expected
  Bytes, provided Object") on every cache-hit request until fixed by passing a base64 **string** across the
  `unstable_cache` boundary and reconstituting the `Buffer` only in the route handler, uniformly on both
  cold and warm paths. **Bugfix (real user report: "die Karte aktualisiert sich nicht")**: the route
  originally sent `Cache-Control: s-maxage=120` — `s-maxage` only constrains shared/CDN caches, of which
  there are none in front of this app (Caddy is a plain reverse proxy, not a cache); it says nothing to a
  private cache (the kiosk browser itself), which — with no `max-age`/`Expires`/`Last-Modified` to bound
  it — fell back to its own heuristic freshness rules and could keep serving the same cached image for a
  long time across the kiosk's 5-minute reloads, regardless of how often the server actually re-fetched.
  Fixed by sending `Cache-Control: no-cache` instead (forces the browser to revalidate with the server on
  every load — with no ETag/Last-Modified set, that means always re-fetching), on both the fresh and
  cached-fallback response branches. The 120s throttle against hammering the real upstream WASTL site is
  unaffected — that protection lives entirely in the server-side `unstable_cache` call, not in this header.
  **Per-district alert-level coloring (fixed, no longer a limitation)**: the real WASTL page's colored
  districts (Normal/Erhöht/Stark) are populated client-side via JavaScript/AJAX polling
  (`createAJAXconnection()`), initially assumed to require a headless browser to reproduce — a targeted
  investigation of that client JS found the AJAX endpoint itself
  (`GetDaten/GetWastlMain.asp?Time=<cache-buster>`, no auth/cookie needed, plain public XML) returns, per
  `<aBAZID>` (district) block, an `<nLayer>` filename pointing at a **pre-rendered, already-colored,
  same-canvas-size transparent GIF** for that district (empty `nLayer` = no incident = no overlay) — the
  real page's own trick is nothing more than stacking these at `position:absolute;top:0;left:0` over the
  static basemap (`<cBackground>`), so no pixel-coordinate guesswork or canvas rendering is needed on our
  side either. The route now: fetches that XML, fetches the basemap + every district's active overlay GIF
  (a single failed overlay fetch is dropped, not fatal to the rest), and composites them at (0,0) via
  `sharp` (new dependency — the second image-processing library in this codebase alongside `qrcode`, added
  specifically because there is no dependency-free way to alpha-composite GIFs in Node) into one PNG, which
  then flows through the exact same `unstable_cache`/`WastlImageCache`-fallback/base64-boundary machinery
  described above unchanged. Verified end-to-end with a standalone script producing a correctly
  color-coded map matching the live page.
- **Facebook feed, hourly cron-fed cache, never a live fetch on page load**: `Organization.facebookPageId`/
  `facebookPageAccessToken` (new, nullable, per-org — analogous to `atemschutzSachbearbeiterEmail` — so
  each Feuerwehr can eventually configure its own page, not just Wolfsgraben). `src/lib/facebook/fetch-posts.ts`'s
  `fetchAndCacheFacebookPosts()` is called only by `src/app/api/cron/facebook-fetch/route.ts`
  (`CRON_SECRET`-gated, `docker/facebook-fetch.sh` hourly wrapper, same shape as the other host-cron
  scripts — the `SCRIPT_DIR`/`REPO_ROOT`/`set -a`/`.env`/`set +a` pattern and crontab-header-comment
  convention, not a hardcoded in-script log path, matching `system-check-email.sh`/`atemschutz-warnung-email.sh`),
  never triggered by a dashboard page visit — a real post roughly once a day doesn't justify a live Graph
  API round-trip on every kiosk reload. Posts (≤90 days old) are cached as `FacebookPostCache.posts` (Json);
  matching images are downloaded once and stored as `Bytes` in a separate `FacebookPostImage` table (same
  Bytes-in-Postgres rationale as `DroneDocument`'s PDFs — no extra Docker volume, rides along in the
  existing `pg_dump` backup), served back via `/api/facebook/image/[postId]/route.ts` rather than
  `next/image` against Facebook's own CDN (whose signed URLs expire — a locally-cached copy is the robust
  choice for a screen running unattended for weeks). `CachedFacebookPost[]` being written into a Prisma
  `Json` column needed an explicit `as unknown as Prisma.InputJsonValue` cast — the first `Json`-typed
  field in this schema, and TypeScript can't structurally prove a named interface (no index signature)
  matches Prisma's recursive JSON value type even when the actual runtime data is fully JSON-safe. Display:
  the newest post **with an image** is shown large (or the most recent one with an image within the last
  30 days, if the newest post itself has none); everything else renders as a compact date+headline list
  through `HeightFittedList`. No `facebookPageId` configured → "Facebook nicht verbunden", never an error.
- **Bugfix (real production report: "Facebook am Dashboard aktualisiert sich nicht")**: the hourly cron
  gave zero real signal about whether the Facebook fetch was actually succeeding.
  `fetchAndCacheFacebookPosts()`'s original `if (!response.ok) return;` silently discarded every Graph API
  error (expired/invalidated token, wrong permissions, etc.) with no logging and no persisted state, and
  `/api/cron/facebook-fetch/route.ts`'s per-org `try/catch { continue; }` loop always returned a flat
  `{ok:true, count:organizations.length}` regardless of whether any individual org's fetch actually worked
  — so 65+ hours of "successful" cron log entries told nothing about the underlying Graph API call. Other
  candidate causes were ruled out first (token still valid via a direct live `curl` at the time, cron
  running hourly per `crontab -l`, `docker/facebook-fetch.sh` correctly tracked executable (`100755`) and
  correctly reading `AUTH_URL`/`CRON_SECRET` from `.env`, not a hardcoded domain) before concluding the real
  problem was this lack of visibility, not any of those. Fixed with the same `<feature>LastSyncAt`/
  `LastSyncError` pattern already established for `icsImportLastSyncAt/-Error` and
  `googleCalendarLastSyncAt/-Error`: new `Organization.facebookLastFetchAt`/`facebookLastFetchError`
  columns, written by a new `markFetchResult()` helper that `fetchAndCacheFacebookPosts()` now calls on
  every path (success, and a caught error whose message is persisted) — the function's whole body is
  wrapped in try/catch and **never throws** (same "external side effect must never block/blow up the
  caller" principle as `notifyFlightCreated`/`notify-system-check.ts`), and a non-OK Graph response now
  reads the response body's own `error.message` before throwing, instead of discarding it. The status is
  surfaced on `/admin/heimatfeuerwehr`'s Facebook config card exactly like `IcsImportForm`/
  `GoogleCalendarConfigForm`'s existing status lines ("Zuletzt aktualisiert: ..." /
  "Letzter Abruf fehlgeschlagen: ..." / "Noch nicht abgerufen (läuft stündlich per Cron-Job)."). Verified
  directly via a standalone script against the local dev database: an invalid-credentials fetch correctly
  populates both fields with the real Graph API error message and does not throw; a fetch with no
  `facebookPageId` configured (the early-return branch) correctly leaves both fields untouched. The local
  dev database has no real Facebook Page Access Token configured, so the actual specific reason
  production's fetch has been failing (or, if it turns out to actually be succeeding, that the dashboard
  render itself was stale for some unrelated reason) could not be reproduced here — that will only be
  revealed once this ships and the next real hourly cron run (or a manually triggered one) writes into
  `facebookLastFetchError` on the production server.
- **Admin section** (`/admin/heimatfeuerwehr`'s "Dashboard Feuerwehrhaus" — a fourth section on the
  same page, not a new route, matching this page's established single-page-multi-section shape): token
  create/list/expire/revoke plus the Facebook Page-ID/Access-Token form. `dashboard-token-actions.ts`'s
  `setTokenExpiry`/`revokeToken` take the token id plus a *claimed* organizationId from the client, but
  re-fetch the token's actual stored `organizationId` from the DB and re-check
  `canManageHeimatfeuerwehrFor` against THAT value before writing — closing the obvious cross-org attempt
  (a Feuerwehr-admin of org A calling the action with org B's token id and org A's own id as the "claimed"
  org) that trusting the claimed id alone would have allowed.
- **`facebookPageAccessToken` never round-trips to the client (final-review fix)**: the page's own
  `allowedOrgs` query (feeding the `OrgSelect` dropdown) only ever `select`s `id`/`name` — it originally had
  no `select` at all, which meant every scalar column, including `facebookPageAccessToken`, was fetched and
  serialized into the RSC payload for **every** Feuerwehr, not just the one currently selected (confirmed
  live: viewing one org's page leaked another org's stored token into the HTML). A separate
  `selectedOrgFull` query (`select: { atemschutzSachbearbeiterEmail, facebookPageId,
  facebookPageAccessToken }`) now fetches those three fields for the currently-selected org only. Beyond
  that cross-org leak, the token isn't sent to the client at all anymore, even for the org's own admin:
  `DashboardFacebookConfigForm` takes a `hasAccessToken: boolean` prop (never the token value), the password
  input has no `defaultValue` and always starts empty, and a "Access Token entfernen" checkbox is the only
  way to clear a stored token. `setFacebookConfig` builds its Prisma `update` `data` object conditionally:
  the checkbox sets `facebookPageAccessToken: null`; a non-empty submitted value overwrites it; an empty
  submission with the checkbox unchecked omits the field from `data` entirely, leaving the stored value
  unchanged — an empty password field must never be misread as "clear the token."
- **Betrieb als Kiosk**: `<meta http-equiv="refresh" content="300">` for a full hard reload every 5
  minutes (deliberately a reload, not polling — clears memory leaks/hung connections on a screen meant to
  run unattended for weeks), with the clock/date updating independently every 15s via a small
  `'use client'` island (`clock-display.tsx`) so the whole page doesn't re-render for that. Chrome launch
  flags and the crontab entry are documented in `docker/README.md`.

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
