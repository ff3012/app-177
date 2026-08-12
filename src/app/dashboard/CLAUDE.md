# CLAUDE.md — Dashboard Feuerwehrhaus

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

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

