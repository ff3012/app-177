# Capacitor App-Store-Rollout (Google Play + Apple App Store) — Design

## Goal

Ship the existing app-177 web app as an installable, publicly listed native app in the Google Play
Store and Apple App Store, using Capacitor as a thin native shell around the existing hosted PWA.
No rewrite of the server-rendered Next.js application, no new backend surface area.

## Context

app-177 is a full Next.js App Router SSR application (`output: 'standalone'` in
`next.config.mjs`), with Server Actions, Auth.js session cookies, Prisma/Postgres, Mailjet email,
and S3-backed photo uploads. It already ships as an installable PWA (manifest + hand-written
service worker) but is not listed in either app store. Push notifications are Web Push (VAPID) via
`src/lib/push/`.

Decisions already made with the app owner (recorded here so the implementation plan doesn't need
to re-litigate them):

- **Scope for this phase**: store auffindbarkeit/installability only. No native push, no native
  camera library, no deep-linking/Universal Links. Push stays Web Push exactly as-is.
- **Distribution**: public listing on both stores (not internal/restricted tracks).
- **Developer accounts**: individual Apple Developer Program + individual Google Play Console
  account (not organization accounts — avoids the D-U-N-S-number wait for Apple's org account
  type).
- **iOS build environment**: the app owner has access to a Mac for Xcode builds; no cloud CI is
  needed for this phase.
- **App identity**: bundle ID / Android `applicationId` = `at.bfkdostpoelten.app` (derived from the
  `bfkdo-stpoelten.at` domain, same value on both platforms). App display name in both stores:
  `APP-17`.

## Architecture

Capacitor's WebView loads the live, already-deployed HTTPS origin directly via `server.url`
(`https://app-17.bfkdo-stpoelten.at` for store/production builds, the dev origin
`https://dev.app-17.bfkdo-stpoelten.at` for internal test builds before cutting a release) — it
does **not** bundle a static export. This was chosen over the two realistic alternatives:

- **Static export + client-only API calls**: would require rearchitecting away from Server
  Actions/Server Components and session-cookie auth across roughly 50 routes. Ruled out as
  disproportionate to the stated goal.
- **Hybrid bundle (static shell, dynamic content via API)**: same rewrite problem, just partial.
  Ruled out for the same reason.

The chosen approach means: all server logic is untouched and continues to run exactly as it does
for browser users today; the native project only adds the minimum native affordances needed for a
store-acceptable experience; and — the practical win — most future feature work (like today's
chip-list fields) ships the same way it always has, live on the server, with **no new store
build/submission required**. A new store build is only needed when native-shell config, icons, or
permissions change.

### Components

- **`capacitor.config.ts`**: `appId`/`appName` per the identity above; `server.url` switched
  between the prod and dev origins via an env var at `cap sync` time (mirrors this project's
  existing dev-first deployment workflow); `server.errorPath` pointing at a bundled offline
  fallback page.
- **Android back-button handling** (`@capacitor/app`): without this, Android's hardware back
  button exits the app instead of navigating the WebView's history, breaking every
  list→detail→list flow.
- **Status bar theming + splash screen** (`@capacitor/status-bar`, `@capacitor/splash-screen`):
  status bar matches the existing dark header color (`#1c1c1e`, the same value already used for
  `viewport.themeColor`/`manifest.ts`'s `theme_color`); splash screen is hidden explicitly once the
  WebView finishes loading the real page, not on a fixed timer.
- **Service worker disabled inside the native shell**: the custom `public/sw.js` is skipped when
  `Capacitor.isNativePlatform()` is true — the native shell already provides "installed app"
  behavior (own process, own icon, own splash), and running both install mechanisms at once risks
  cache conflicts with no clear precedence between them.
- **iOS permission strings** (`Info.plist`): `NSCameraUsageDescription`/
  `NSPhotoLibraryUsageDescription`. Without these, the existing `<input type="file">`-based photo
  upload silently fails to show the camera/photo-library picker inside iOS's WKWebView — this is a
  real, easy-to-miss failure mode, not a hypothetical one.
- **App icons/splash assets**: generated via `@capacitor/assets` from the existing
  `public/wappen-bfkdo.png` source (the same artwork already used for the PWA icon set), composited
  onto white (icon) and the dark theme color (splash) — same generation approach already
  established for the PWA icons (documented in root `CLAUDE.md`'s rebrand section).
- **Offline fallback page**: a minimal, locally bundled HTML page (not served by the Next.js app)
  shown when the WebView can't reach the remote origin, with a retry button — avoids a blank white
  screen or a raw browser network-error page as the first impression of a store-installed app.
- **`/datenschutz` privacy policy page**: does not exist yet and is a hard prerequisite for
  submission to either store (both require a privacy policy URL; Google additionally requires a
  Data Safety questionnaire referencing the same disclosures). Built as a static public page,
  following the same "no login, no `(app)` chrome" pattern already used for
  `drohnen-schnell/[token]`, added to `middleware.ts`'s `PUBLIC_PATH_PREFIXES`.

### Data flow

Unchanged from today's browser experience: the WebView makes the same HTTPS requests to the same
origin, with the same cookies, the same CSP, the same Server Actions. Nothing new is added to the
backend. The only new "data flow" is Capacitor's own bridge calls (status bar color, splash
hide, back-button events), which are local to the device and never touch the network.

### Error handling

- Network/loading failure while inside the app → the bundled offline fallback page, not a blank
  screen or raw error page.
- Missing iOS permission strings → silently broken photo picker with no visible error at all,
  which is exactly why this is called out as an explicit task rather than left to be discovered
  during store review.
- Capacitor plugin calls (`StatusBar`, `SplashScreen`) are all wrapped so a plugin failure never
  blocks the app from loading — matches this codebase's existing convention of never letting a
  secondary concern (e.g. a notification email) block the primary user action.

### Testing

There is no automated test suite in this repo, and Capacitor-specific behavior (hardware back
button, native permission prompts, splash/status-bar rendering, offline fallback) is inherently
device-level, not something a browser-based check or `tsc`/`next build` can verify. Verification
is: `tsc`/`build` pass for every code change, then a manual walkthrough of the core flows (login,
Kalender, Drohnenflug registration incl. the photo-upload permission prompt, Fahrzeug-Reservierung)
on a real device/simulator for both platforms, first against the dev origin, then repeated against
the prod origin (the actual shipping configuration) before cutting a store build.

## Two-part scope

This is one design but naturally splits into two very differently-shaped pieces of work:

- **Part A — code changes** (this repo): privacy policy page, Capacitor installation and platform
  init, the native-shell adjustments listed above, and a device-verification pass. This part gets
  a normal implementation plan via `writing-plans`/`subagent-driven-development`.
- **Part B — store submission runbook** (outside this repo, manual, no code): creating the two
  developer accounts, registering the App ID, generating signing credentials (iOS certificate +
  provisioning profile, Android upload keystore — **the keystore must be backed up outside the
  repo**, losing it blocks all future updates to the same Play Store listing), filling in both
  stores' listing metadata (description, screenshots, age rating, Google's Data Safety
  questionnaire — referencing `/datenschutz`), an internal-testing pass on signed release builds
  (TestFlight / Play internal track), then submitting for review. This part is a checklist to work
  through directly, not something `writing-plans`/SDD can execute — there's no test cycle in the
  code sense, and most steps are account/portal actions no agent can perform.

If Apple raises Guideline 4.2 ("Minimum Functionality") during review, the app's real operational
utility (event calendar, drone-flight compliance logging, vehicle-reservation approval workflow,
member management for a real volunteer-fire-department organization) is the relevant distinction
from a marketing-site wrapper — noted here so it doesn't need to be re-researched if it comes up.
