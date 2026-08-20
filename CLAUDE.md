# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


> **Module-specific deep-dive documentation has moved to nested CLAUDE.md files** (loaded automatically when Claude works in that directory): Kalender → `src/components/calendar/CLAUDE.md`, Drohnengruppe → `src/components/drone/CLAUDE.md`, Verwaltung/admin → `src/app/(app)/admin/CLAUDE.md`, Email → `src/lib/email/CLAUDE.md`, News → `src/lib/push/CLAUDE.md`, Meine Feuerwehr/Fahrzeug-Reservierungen/Startbildschirm/Funktionsschalter → `src/app/(app)/meine-feuerwehr/CLAUDE.md`, Dashboard Feuerwehrhaus → `src/app/dashboard/CLAUDE.md`. This root file keeps only universal, cross-cutting content.

## What this is

A member-facing web app for the Freiwillige Feuerwehr of **Bezirk 17 St. Pölten** (Austria): one Bezirk →
**7 Abschnitte** (Abschnittsfeuerwehrkommandos: Herzogenburg, Kirchberg/Pielach, Neulengbach, Purkersdorf,
St. Pölten-West, St. Pölten-Stadt, St. Pölten-Ost) → **124 Feuerwehren/Betriebsfeuerwehren**, plus
**4 Drohnengruppen**, each anchored at one Abschnitt. It started as a single-Abschnitt app (Abschnitt
Purkersdorf, 9 Feuerwehren, ~200 users) and was expanded to the full Bezirk — a lot of the history recorded
further down in this file was written while that flat, single-Abschnitt world still held, so **read the
"Bezirk / Abschnitt / Feuerwehr hierarchy" section below before writing any query that touches
`Organization`, `Event` visibility, or Drohnengruppen data**; the hierarchy and its scoping rules override
any older passage here that contradicts them.

Three modules: **Kalender** (per-org + Abschnitt-wide event calendar with .ics export, calendar-grid or
list view), **Drohnengruppe** (drone flight log, including a QR-code quick-registration flow — see below),
and **News** (Web Push notifications to a Feuerwehr or a Drohnengruppe, sent immediately or scheduled — see
below). Installable as a PWA (manifest + minimal service worker) so it can be added to an iOS/Android home
screen without an app-store build. All UI copy and commit-adjacent docs are German; code identifiers are a
German/English mix (keep matching the existing convention in a given file).

Branding is still Purkersdorf-specific in one remaining place: the login page's own `<h1>` heading
(`src/app/(auth)/login/page.tsx`) — a known, deliberately deferred follow-up, not a sign that the app is
still single-Abschnitt. As of the 2026-08-20 Bezirk-17 rebrand (same effort as that day's prod/dev domain
migrations): the desktop/mobile header wordmark, footer, all transactional email templates, and the PWA
manifest's `name`/`short_name`/`description`/`appleWebApp.title` (`src/app/layout.tsx`, `src/app/manifest.ts`)
now say "BFKDO St. Pölten"/"Bezirksfeuerwehrkommando St. Pölten"; the Wappen image itself (login page,
header, dashboard kiosk, drohnen-schnell, and the PWA icon set) was swapped from `wappen-afkdo.png` to a
new `wappen-bfkdo.png` everywhere it appeared. The login `<h1>` is the one spot the Wappen/email/domain/PWA
work never touched.

## Commands

```bash
npm run dev            # local dev server
npm run build           # production build
npm run lint             # next lint

npm run db:migrate      # prisma migrate dev (local) — generates a new migration from schema.prisma changes
npm run db:deploy       # prisma migrate deploy — applies committed migrations (used in prod, see entrypoint.sh)
npm run db:seed         # tsx prisma/seed.ts — 7 Abschnitte + 124 Feuerwehren, 4 Drohnengruppen, Dienstgrade, bootstrap admin
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
- `build-session-user.ts` computes the `SessionUser` claims object (`isBezirksAdmin`,
  `abschnittAdminOrgIds`, `feuerwehrAdminOrgIds`, `homeAbschnittOrganizationId`, `isDrohnengruppeMember`,
  `droneGroupId`, `droneGroupRole`, etc.) from a `User` + relations. This is the *only* place that shape
  gets built — both the login path and the per-request refresh path call it. How the two admin-org arrays
  differ (and why the direct-membership half must stay type-unfiltered) is documented in the
  "Bezirk / Abschnitt / Feuerwehr hierarchy" section above — read it before touching this function.
- `lib/auth/permissions.ts` holds plain, composable predicate functions (`canManageEventsFor`,
  `canViewDroneModule`, `canManageFlight`, ...) — there is no RBAC library and no middleware-level
  fine-grained authorization; every Server Action/page re-checks permissions itself using these functions.
  When adding a new capability, add a function here rather than inlining a condition at the call site.
- `isBezirksAdmin` (the former `isSiteAdmin`, renamed and re-scoped when the Bezirk hierarchy landed — every
  passage below that still says `isSiteAdmin` means this) and `isDroneGroupAdmin` (Admin Drohnengruppe) are
  **independent** rights. Bezirksadmin does not imply Drohnengruppe *module* access, by design — see the
  comment above `canViewDroneModule` for the reasoning if you're tempted to "simplify" this. (It does imply
  the right to *administer* any group via `canManageDroneGroupFor`, which is a different question.)
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

### Bezirk / Abschnitt / Feuerwehr hierarchy + Drohnengruppen

The single most important structural fact about this codebase, and the one that most older passages below
predate. Design rationale:
`docs/superpowers/specs/2026-08-09-bezirk-abschnitt-drohnengruppen-design.md`.

**Models.** `District` (one row: `number: '17'`, `name: 'St. Pölten'`) → `Organization.districtId`
(set on the 7 `ABSCHNITTSKOMMANDO` rows only) → `Organization.parentId`, a **self-reference on the same
table** (`OrgHierarchy`), set on every `FEUERWEHR` row and pointing at its Abschnittskommando. There is no
separate "Abschnitt" table — `Organization` still carries both types, exactly as before, just with a parent
link now. `src/lib/organizations/abschnitt.ts`'s `getAbschnittOrganizationId(org)` is the single place that
resolves "which Abschnitt does this organization belong to" (itself if `ABSCHNITTSKOMMANDO`, else
`parentId`); it **throws** rather than returning null if a Feuerwehr has no parent, because a silently
null-propagated Abschnitt id used to surface as a cryptic Prisma validation error deep inside an unrelated
query.

`DroneGroup` (`name` unique, `organizationId` → the ABSCHNITTSKOMMANDO it's anchored at, plus its own
`flightNotificationEmail` and `qrToken`) replaces the former single, app-wide Drohnengruppe. Four rows
today; there is no admin UI to create a fifth — they come from `prisma/seed.ts` / the backfill migration.
`Drone.name` is unique **per group** (`@@unique([droneGroupId, name])`), no longer globally — two groups may
both have a "Drohne 1".

**Three permission tiers** (`src/lib/auth/permissions.ts`, no RBAC library — same plain-predicate style as
everywhere else in this file):
- **Bezirksadmin** — `User.isBezirksAdmin`, a plain boolean column. Replaces the former `isSiteAdmin`
  ("Abschnittskommando-Admin") wherever that meant "top of the app". District-wide.
- **Abschnittsadmin** — an ADMIN `Membership` on an `ABSCHNITTSKOMMANDO` organization, surfaced as
  `SessionUser.abschnittAdminOrgIds`. Scoped to that one Abschnitt.
- **Feuerwehr-Admin** — an ADMIN `Membership` on a `FEUERWEHR` organization.

`build-session-user.ts` computes two separate arrays, and the distinction matters:
- `abschnittAdminOrgIds` — ADMIN memberships **filtered to `ABSCHNITTSKOMMANDO` type only**. Used for
  "may this person act at Abschnitt level".
- `feuerwehrAdminOrgIds` — **every** direct ADMIN membership regardless of type (so an Abschnittsadmin's own
  Abschnitt organization *is* in here), **plus** every `FEUERWEHR` whose `parentId` is in
  `abschnittAdminOrgIds` (inheritance: an Abschnittsadmin automatically administers all their Feuerwehren).
  The name is historical; read it as "organizations whose day-to-day admin surfaces this person may use".
  **Do not re-add a type filter to the direct-membership half.** It was tried and broke two features at
  once, because the Kalender form's organization picker is built from this array and `event-form.tsx` only
  renders the "Abschnitt-weiter Termin" checkbox and the Kategorie select when an `ABSCHNITTSKOMMANDO`
  option is selectable — without it, section-wide and Drohnengruppen events became uncreatable for
  everyone, and every existing Abschnittskommando-owned event became uneditable (`canManageEventsFor` reads
  only this array and has no Bezirksadmin bypass, by long-standing design).

**Event visibility for `category === 'ALLGEMEIN'` is Abschnitt-scoped, not app-wide; `DROHNENGRUPPE` is a
completely separate, category-first rule.** `canViewEvent` (`src/lib/auth/permissions.ts`, and the identical
rule mirrored in `kalender/page.tsx`'s own query, `meine-feuerwehr/page.tsx`'s own query, the single-event
`.ics` route, and `push/audience.ts`) branches on `event.category` first:
- `ALLGEMEIN`: `event.organizationId === user.homeOrganizationId` **OR** (`event.isSectionWide` **AND** the
  event's Abschnitt equals the viewer's own `homeAbschnittOrganizationId`). A section-wide event never
  leaves its own Abschnitt. Unchanged from before the multi-Drohnengruppe plan.
- `DROHNENGRUPPE`: `canViewDroneModule(user)` **AND** (`event.droneGroupId === null` **OR**
  `event.droneGroupId === user.droneGroupId`) — completely **independent** of `organizationId`/
  `isSectionWide`. Those two fields are still populated on a `DROHNENGRUPPE` event (server-derived in
  `kalender/actions.ts` — the anchor group's organization, or the creator's own Abschnitt for a bezirksweit
  event), but purely as technical FK/legacy-column values, never read by any visibility check.
  `event.droneGroupId === null` is a **deliberate sentinel**, not an absent/invalid value: it means
  "bezirksweit", visible to members of **all 4** Drohnengruppen (same null-means-"all" pattern already used
  by `NewsPost.droneGroupId`) — the combined per-org token `.ics` feeds are the one exception,
  since they're token- rather than session-authenticated and can't check `canViewDroneModule`, so they
  exclude the whole `DROHNENGRUPPE` category outright rather than trying to apply this rule.
- Create/edit/delete/push authorization for an `Event` goes through the separate `canManageEvent(user,
  event, droneGroup)` function, also category-first: `ALLGEMEIN` still delegates to `canManageEventsFor`
  unchanged; `DROHNENGRUPPE` with a set `droneGroupId` delegates to `canManageDroneGroupFor` for that
  specific group (module membership alone is not enough — a plain Pilot/Mitglied without an ADMIN role in
  that group has no create/edit/delete right); `DROHNENGRUPPE` with `droneGroupId === null` (bezirksweit)
  requires `canManageBezirksWideDroneEvent` (Bezirksadmin or Bezirks-Drohnenadmin only — not any single
  group's Admin, not an Abschnittsadmin, since a bezirksweit event crosses group/Abschnitt boundaries).
`canCreateSectionWideEvent(user, abschnittOrganizationId)` takes the **target** Abschnitt and delegates to
`canManageAbschnittFor`; a blanket "admins some Abschnitt" check is not sufficient and is only used as a
UI pre-check (`canCreateAnySectionWideEvent`). Both of these two functions are `ALLGEMEIN`-only — they play
no role for `DROHNENGRUPPE` events, which never carry a meaningful `isSectionWide`.

**Drohnengruppen data is group-scoped throughout**: drones, `DroneDocument` PDFs, member roster, the QR
quick-register token, the flight-notification email, News' `DROHNENGRUPPE` audience, and the 90-day
compliance views. `canManageDroneGroupFor(user, droneGroup)` = Bezirksadmin, or Abschnittsadmin of the
Abschnitt the group is anchored at, or ADMIN of that same group — it gates `/admin/drohnen` **and** who may
assign a user *into* a group from Benutzerverwaltung.

**`/admin/*` gating**: `admin/layout.tsx` admits Bezirksadmins, Abschnittsadmins, Feuerwehr-Admins **and**
pure Drohnengruppen-Admins (someone with no organization admin right at all). It therefore proves almost
nothing on its own — every `/admin/*` page still needs its own explicit check, and every admin Server
Action re-checks independently. `lib/admin/nav-items.ts` decides which entries a given tier sees;
`lib/nav-items.ts`'s `getVerwaltungNavItem()` decides where the top-level "Verwaltung" link points
(Bezirksadmin → `/admin/benutzer`, org-admin → `/admin/heimatfeuerwehr`, pure Drohnengruppen-Admin →
`/admin/drohnen`, otherwise no link) and is shared by the desktop nav and the mobile header pill.

**Migrations.** `20260809000000_hierarchie_additive` adds every new column/table nullable;
`20260809010000_hierarchie_backfill` then does all the data work — creates District 17 and the
`dronegroup-afkdo-purkersdorf` group, moves every pre-existing membership/document/drone/**event** onto it,
sets `parentId` on the 9 original Purkersdorf Feuerwehren, and flags the bootstrap admin as Bezirksadmin —
before tightening the three mandatory columns to `NOT NULL`. The `parentId`/`isBezirksAdmin` writes
deliberately live in the **migration**, not only in `prisma/seed.ts`: `docker/entrypoint.sh` runs
`prisma migrate deploy` automatically on container start but never seeds, so anything only the seed does
does not exist between deploy and someone remembering to run `npm run db:seed` by hand.

### Data model (`prisma/schema.prisma`)

- `Organization` is one table for both Feuerwehren and the Abschnittskommandos (`type` enum), not two
  tables — keeps every FK (`Membership`, `Event.organizationId`) pointing at a single target. Since the
  Bezirk expansion it also carries `districtId` and the self-referencing `parentId`/`children` hierarchy —
  see the section above.
- `Organization.nummer` is the official Niederösterreichische Landesfeuerwehr-Nummer (`String`, required,
  `@unique`) — added specifically so future modules have a stable, human-meaningful identifier to reference a
  Feuerwehr/das AFKDO by, instead of the opaque `cuid()` `id`. Values: AFKDO Purkersdorf `17700`, Gablitz
  `17701`, Mauerbach `17702`, Pressbaum `17703`, Purkersdorf `17704`, Rekawinkel `17706`, Steinbach `17707`,
  Tullnerbach `17708`, Tullnerbach-Irenental `17709`, Wolfsgraben `17711`. Since the Bezirk expansion this
  is no longer the full list — all 124 Feuerwehren of Bezirk 17 carry their real `nummer`, seeded from
  `prisma/data/feuerwehren-bezirk-17-raw.json`, and the 6 new Abschnittskommandos follow Purkersdorf's
  `{Abschnittsnummer}00` convention (`17100`, `17200`, …). The gaps at `17705`/`17710` are still gaps in
  the Purkersdorf Abschnitt, but those numbers belong to Feuerwehren of **other Abschnitte** that are now
  in this database too — they are no longer "outside the app". `prisma/seed.ts`'s
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
  PILOT/ADMIN) is a separate table, still cross-org in the sense that it has nothing to do with which
  Feuerwehr someone belongs to — but **no longer flat**: it carries a mandatory `droneGroupId` (one of the
  4 `DroneGroup` rows), and every read path is scoped by it. A user has at most one drone membership, hence
  at most one group (`SessionUser.droneGroupId`).
- `Event.category` (ALLGEMEIN/DROHNENGRUPPE) decides which of two unrelated visibility rules applies — see
  "Bezirk / Abschnitt / Feuerwehr hierarchy" above for the full rule. For `ALLGEMEIN`, `Event.isSectionWide`
  is what makes it **Abschnitt-scoped**: `isSectionWide` means "visible across the event's own Abschnitt",
  never across the whole Bezirk. For `DROHNENGRUPPE`, `isSectionWide`/`organizationId` play no role at all —
  visibility is `canViewDroneModule` **plus** `Event.droneGroupId` either matching the viewer's own group
  exactly, or being `null` (a deliberate "bezirksweit, all 4 groups" sentinel, not an absent/invalid value).
  The `.ics` feeds are token- rather than session-authenticated and so can't check membership — they exclude
  the Drohnengruppe category entirely instead of trying, and the per-organization feed applies the same
  Abschnitt scoping as the Kalender query (for its `ALLGEMEIN` events only, by the same token).
- `DroneFlight` has two separate `User` relations: `registeredBy` (who logged the entry — controls edit
  rights) and `pilotUser` (who actually flew — a dropdown of current Drohnengruppe members in the form, not
  free text). Don't conflate the two; "can I edit this flight" is based on `registeredBy`, not `pilotUser`.
- `AppSettings` is a singleton table (always exactly one row, `id = "singleton"`, upserted — never
  `create`d directly) for admin-configurable values that don't warrant their own table (system-check
  recipient, backup/cron timestamps, …). Read/write it only through `src/lib/settings.ts`, not raw Prisma
  calls at the call site. **Its former `droneFlightNotificationEmail` and `droneQuickRegisterToken` columns
  are gone** — both moved onto `DroneGroup` (`flightNotificationEmail`, `qrToken`), since they are per-group
  now, not app-wide.
- `PushSubscription` (one row per browser/device, keyed by that browser's own `endpoint`) and `NewsPost`
  (`audience` FIRE_DEPARTMENT/DRONE_GROUP + optional `fireDepartmentId` + optional `droneGroupId`,
  `scheduledAt`/`sentAt`) back the News module — see below. For a DRONE_GROUP audience, a null
  `droneGroupId` deliberately means "all groups"; a set one narrows to that one group. `NewsRead`
  (composite `newsPostId`+`userId` key) tracks per-user read state, driving the reader's own unread badge —
  there is no admin-visible "X von Y gelesen" readout anywhere in the app, by deliberate design.
- Migrations are committed SQL under `prisma/migrations/`, applied automatically by
  `docker/entrypoint.sh` via `prisma migrate deploy` on every container start. Generate new ones with
  `npm run db:migrate` after editing `schema.prisma`; don't hand-edit already-committed migration files.

### PWA

`src/app/manifest.ts` (Next.js manifest convention) + `public/icons/*` (generated from `public/wappen-bfkdo.png`
via a one-off PowerShell/System.Drawing script, not checked in — regenerated 2026-08-20 for the Bezirk-17
rebrand; same sizes as before, composited onto a white background matching `manifest.ts`'s own
`background_color`) + `public/sw.js` (hand-written, no
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
