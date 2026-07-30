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
to that `environment:` block or the container never sees it. This has already caused one deploy where the
News module's `VAPID_*`/`CRON_SECRET` vars were set in `.env` but silently missing at runtime.

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
`ical-generator` for .ics · Mailjet REST API directly via `fetch` (no SDK) for transactional email.

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
with a `layer` (`own` / `abschnitt` / `drohnengruppe`) and a `category`, and hands them to
`components/calendar/kalender-with-layers.tsx`, a client component that renders one `ToggleSwitch` per layer
(default: all on), filters client-side, and then renders either `CalendarView` (FullCalendar grid) or
`EventListView` (compact `table-fixed` table: Datum/Start/Tag/Betreff/Organisation/Zusagen-Badge, `text-xs`
with tight padding so it stays inside the page's `max-w-5xl` column without horizontal scrolling) depending
on a `viewMode` toggle — **list is the default view** for all users, not the calendar grid. Adding a new
layer means: extend the `layer` tagging logic in the page, add it to the `layers` array passed down, and pick
a `backgroundColor` for it; both `CalendarEventInput` consumers (grid + list) read the same event shape, so
add new fields there once. Every `EventListView` row is clickable regardless of `event.editable` — a single
click opens the detail page (RSVP + full info, see below), a double-click on an editable row instead jumps
straight to the edit form. Since a browser fires two ordinary `click` events before recognizing a
`dblclick`, the single-click navigation is deferred by `DOUBLE_CLICK_WINDOW_MS` (220ms) in `EventListRow`
and cancelled if a `dblclick` arrives in that window — don't remove that debounce, a plain `onClick`
would navigate away before the `dblclick` handler ever fires. Rows also carry an explicit "Zusage" link
to the same detail page next to the add-to-calendar icon, for discoverability.

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

The .ics subscription links live in their own "ICS Kalender Import" card below the calendar (not the page
header) with a copy-to-clipboard button (`components/ui/copy-link-button.tsx`) next to each. Separately,
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
  new `AdminNav` entry, unless the feature needs its own URL. The 1MB default Server Action body
  limit was raised app-wide to 10MB (`next.config.mjs`) specifically for this upload, since Server
  Actions have no per-route size config.
- **90-day/3-flight rule**: constants and the shared cutoff/predicate helpers live in
  `src/lib/drone/ninety-day-rule.ts` (`NINETY_DAY_REQUIRED_FLIGHTS`, `NINETY_DAY_WINDOW_DAYS`,
  `getNinetyDayCutoff()`, `meetsNinetyDayRule()`) — both the Admin-only `/drohnen/90-tage` report (all
  members) and the green/red badge every member sees for *themselves* next to "Flug registrieren" on
  `/drohnen` read from here, so the rule can never drift between the two views.
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

### Verwaltung (admin) navigation

All `/admin/*` pages (`benutzer`, `drohnen`, `email`, `status`) are independently gated by `isSiteAdmin` and
share `components/layout/admin-nav.tsx` (`AdminNav`) — four equally-styled buttons, active one highlighted,
rendered under a plain "Verwaltung" `<h1>` on every page. Add a new admin page by (1) gating it the same way,
(2) adding one entry to `AdminNav`'s `ITEMS`, not by inventing another sub-nav pattern.

- `/admin/benutzer` — `UserManagementSection` (client) owns free-text search and click-to-sort-any-column
  over a flat `UserRow[]` the server maps the Prisma result into; don't push search/sort server-side, ~200
  users is small enough to do it in the browser. `/admin/benutzer/neu`'s "Willkommen-E-Mail senden" toggle
  (default on) still creates the user + activation token either way — turning it off just skips
  `sendActivationEmail` and instead renders the activation link on the same page (with a copy button) for
  the admin to hand over manually; there's no way today to retrieve that link again afterward if the admin
  navigates away without copying it (the admin-triggered password-reset email is a separate, unrelated flow
  for existing users, not a way to recover this). `User.stbNr`/`User.phone` (Standesbuchnummer, E.164 phone)
  are plain optional fields with no DB-level uniqueness — `phone` is only format-validated
  (`E164_PHONE_REGEX` in `lib/validation/user.schema.ts`), and the create form pre-fills `+43` as a starting
  point (edit mode leaves it untouched).
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
  "Off-Box-Kopie" in `docker/README.md`. Retention for that copy is a lifecycle rule in the Exoscale
  console, not scripted deletion, so the script doesn't need a second delete path against a second storage
  API. "NTP-Synchronisierung"
  can't run a real NTP client check inside the container either (it shares the host's clock, so there's
  nothing container-local to check) — `src/lib/system/ntp-check.ts` instead compares local time against the
  `Date` response header of an external HTTPS call (`api.mailjet.com`) as a drift proxy, flagging >10s as
  out of sync.

### Email

`src/lib/email/mailjet.ts` is a thin `fetch` wrapper around Mailjet's v3.1 Send API (no SDK dependency), plus
`checkMailjetConnection()` for the Status-page health check (read-only, sends nothing).
`src/lib/email/templates.ts` builds the transactional emails (activation, password reset); `AUTH_URL` is the
base for the links it builds. `src/lib/email/escape-html.ts` (`escapeHtml`) is used wherever free-text or
user-controlled values (flight location, feedback message) get interpolated into an email's `htmlPart` —
`templates.ts` itself predates this and still doesn't escape `firstName`, a known minor gap, but new email
code should use it. `/admin/email` has a manual "send test email" action for verifying the Mailjet API
key/sender config without triggering a real activation or reset flow, plus the `droneFlightNotificationEmail`
setting (`AppSettings`) editable via `DroneFlightEmailForm`.

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
