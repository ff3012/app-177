# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A member-facing web app for the Freiwillige Feuerwehr Abschnitt Purkersdorf (Austria): 9 Feuerwehren + 1
Abschnittsfeuerwehrkommando (AFKDO), ~200 users. Two modules: **Kalender** (per-org + Abschnitt-wide event
calendar with .ics export) and **Drohnengruppe** (drone flight log). All UI copy and commit-adjacent docs are
German; code identifiers are a German/English mix (keep matching the existing convention in a given file).

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
- Migrations are committed SQL under `prisma/migrations/`, applied automatically by
  `docker/entrypoint.sh` via `prisma migrate deploy` on every container start. Generate new ones with
  `npm run db:migrate` after editing `schema.prisma`; don't hand-edit already-committed migration files.

### Kalender module

`src/app/(app)/kalender/page.tsx` is the single calendar page (an earlier separate `/kalender/abschnitt` page
was merged in and now just redirects here). It fetches every event the user is allowed to see, tags each
with a `layer` (`own` / `abschnitt` / `drohnengruppe`), and hands them to
`components/calendar/kalender-with-layers.tsx`, a client component that renders one `ToggleSwitch` per layer
(default: all on) and filters client-side before handing the remainder to `CalendarView` (FullCalendar
wrapper). Adding a new layer means: extend the `layer` tagging logic in the page, add it to the `layers`
array passed down, and pick a `backgroundColor` for it.

### Drohnengruppe module

Visibility of the whole module and of *all* flights (vs. just your own + ones you piloted) are separate
checks — `canViewDroneModule` (module visibility) vs. `canViewAllFlights` (row-level scope, Admin
Drohnengruppe only). `src/lib/drone/members.ts` (`listDrohnengruppeMembers`) is the shared query for
"who can be picked as a pilot" — reused by the flight form, the 90-day report, and nowhere else; keep it that
way rather than duplicating the `where: { droneMembership: { isNot: null } }` filter.

### Email

`src/lib/email/mailjet.ts` is a thin `fetch` wrapper around Mailjet's v3.1 Send API (no SDK dependency).
`src/lib/email/templates.ts` builds the two transactional emails (activation, password reset); `AUTH_URL` is
the base for the links it builds. `/admin/email` has a manual "send test email" action for verifying the
Mailjet API key/sender config without triggering a real activation or reset flow.
