# Capacitor App-Store-Rollout (Part A: Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Environment constraint — read before dispatching any task:** the coding agent runs on Windows
> with no Xcode and no Android Studio installed. Tasks 1, 2 (steps 1-2, 4-7), 3, 4, 5, 6 (step 2
> only), and 8 are fully buildable and verifiable in this environment via `npm`/`npx`, `tsc`, and
> `next build`. Task 2 step 3 (`npx cap add ios`/`npx cap add android`) generates native project
> folders and works cross-platform without Xcode/Android Studio installed — confirm this actually
> succeeds before relying on it; if it doesn't, this step needs the user's Mac instead. Task 6 step
> 1 (editing `Info.plist`) is a plain XML edit and works fine here. Task 7's asset *generation*
> (`npx capacitor-assets generate`) is a CLI step that should work here, but its *visual
> verification* (opening Xcode/Android Studio to eyeball the result) does not. Task 9 (device
> testing) cannot be executed or verified by the agent at all — every step in it requires the
> user's own Mac (Xcode + a simulator or their iPhone) and an Android emulator/device. **Any step
> marked `⚠️ USER-ONLY` below must be handed back to the user, never marked complete by an agent.**

**Goal:** Wrap the existing app-177 web app in a Capacitor native shell (WebView pointed at the
live hosted origin) so it can be submitted to the Apple App Store and Google Play Store, with no
changes to the server-rendered application itself.

**Architecture:** `capacitor.config.ts`'s `server.url` points the native WebView directly at the
already-deployed HTTPS origin (prod or dev, switched by an env var) — there is no local static
bundle of app pages. The native projects (`ios/`, `android/`) only carry shell-level concerns:
back-button handling, status bar/splash theming, permission strings, icons, and an offline fallback
page. A new `/datenschutz` page is added to the Next.js app itself (required by both stores).

**Tech Stack:** Capacitor 6 (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`,
`@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/assets` dev
dependency), existing Next.js 15 / React / Tailwind stack (unchanged).

## Global Constraints

- Bundle ID / Android `applicationId`: `at.bfkdostpoelten.app` (identical on both platforms).
- App display name (both stores, and Capacitor's `appName`): `APP-17`.
- No native push notifications, no native camera library, no deep-linking/Universal Links in this
  phase — do not add `@capacitor/push-notifications`, `@capacitor/camera`, or any Associated
  Domains / App Links configuration.
- The app is loaded via `server.url` pointing at a live origin — never switch to a locally bundled
  `webDir` of static Next.js output.
- Two origins must remain switchable at `cap sync` time: prod `https://app-17.bfkdo-stpoelten.at`
  and dev `https://dev.app-17.bfkdo-stpoelten.at`.
- `ios/` and `android/` native project folders are committed to git (Capacitor's own convention —
  they hold source config, not build output); only their generated build-artifact subfolders
  (`ios/App/Pods/`, `android/.gradle/`, `android/app/build/`, etc.) are gitignored.
- No automated test suite exists in this repo. Verification for every task is `npx tsc --noEmit` +
  `npm run build`, plus (where marked ⚠️ USER-ONLY) manual device verification the agent cannot
  perform.

---

### Task 1: `/datenschutz` privacy policy page

**Files:**
- Create: `src/app/datenschutz/page.tsx`
- Modify: `src/middleware.ts:4-19` (add `/datenschutz` to `PUBLIC_PATH_PREFIXES`)

**Interfaces:**
- Consumes: `Footer` from `@/components/layout/footer` (named export, no props).
- Produces: a publicly reachable `/datenschutz` route — Task 9's runbook references this URL as
  the Privacy Policy URL for both store listings; no other task in this plan depends on it.

- [ ] **Step 1: Write the page**

Create `src/app/datenschutz/page.tsx`:

```tsx
import { Footer } from '@/components/layout/footer';

export const metadata = { title: 'Datenschutzerklärung — APP-17' };

export default function DatenschutzPage() {
  return (
    <div className="pt-safe flex min-h-screen flex-col bg-[#f6f6f7]">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 text-sm leading-relaxed text-neutral-800">
        <h1 className="mb-6 text-2xl font-semibold text-neutral-900">Datenschutzerklärung</h1>

        <p className="mb-4">
          Diese App (&bdquo;APP-17&ldquo;) wird vom Bezirksfeuerwehrkommando St. Pölten für Mitglieder der
          Freiwilligen Feuerwehren im Bezirk 17 St. Pölten bereitgestellt. Diese Erklärung beschreibt, welche
          personenbezogenen Daten verarbeitet werden und zu welchem Zweck.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Verantwortlicher</h2>
        <p className="mb-4">
          Bezirksfeuerwehrkommando St. Pölten. Kontakt für Datenschutzanfragen:{' '}
          florian.krebs@feuerwehr.gv.at.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Welche Daten werden verarbeitet</h2>
        <ul className="mb-4 list-disc pl-5">
          <li>Konto- und Profildaten: Name, E-Mail-Adresse, Telefonnummer, Dienstgrad, Standesbuchnummer, Heimatfeuerwehr.</li>
          <li>Nutzungsdaten der Feuerwehr-Module: Kalendereinträge, Drohnenflug-Protokolle, Fahrzeug-Reservierungen, hochgeladene Einsatz-/Übungsfotos.</li>
          <li>Technische Daten: Push-Benachrichtigungs-Endpunkte (nur bei aktivierter Benachrichtigungsfunktion), Zeitpunkt der letzten Anmeldung.</li>
        </ul>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Zweck der Verarbeitung</h2>
        <p className="mb-4">
          Die Daten dienen ausschließlich der internen Organisation der Feuerwehren im Bezirk 17 (Terminplanung,
          Drohnengruppen-Verwaltung, Fahrzeug-Reservierung, Atemschutz-Nachweis, Fotodokumentation). Es findet
          keine Weitergabe an Dritte zu Werbezwecken statt.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Speicherdauer</h2>
        <p className="mb-4">
          Daten werden für die Dauer der Mitgliedschaft bzw. bis zur Deaktivierung des Zugangs gespeichert und
          können auf Anfrage gelöscht werden, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Rechte der Nutzer</h2>
        <p className="mb-4">
          Jedes Mitglied hat das Recht auf Auskunft, Berichtigung und Löschung der eigenen Daten. Anfragen bitte
          an obige Kontaktadresse.
        </p>
      </div>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Add the route to the public-path allowlist**

Read `src/middleware.ts` first. In its `PUBLIC_PATH_PREFIXES` array, add `'/datenschutz'` as a new
entry (any position — order doesn't matter, `.some()` just checks prefix match). The array
currently reads:

```ts
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/health',
  '/kalender/ics',
  '/aktivieren',
  '/passwort-vergessen',
  '/passwort-zuruecksetzen',
  '/drohnen-schnell',
  '/api/cron',
  '/dashboard',
  '/api/wastl',
  '/api/facebook/image',
  '/fahrzeug-reservierung',
  '/how-to.html',
];
```

Add `'/datenschutz'` to it.

- [ ] **Step 3: Verify**

Run:

```bash
npx tsc --noEmit
npm run build
```

Then start the app locally (`npm run dev`) and, in an incognito/private browser window (no
session cookie), navigate to `http://localhost:3000/datenschutz`. Confirm it renders the page
content directly, without redirecting to `/login`.

- [ ] **Step 4: Commit**

```bash
git add src/app/datenschutz/page.tsx src/middleware.ts
git commit -m "feat: add public Datenschutzerklärung page for App/Play Store submission"
```

---

### Task 2: Install Capacitor and initialize iOS + Android platforms

**Files:**
- Create: `capacitor.config.ts`
- Create: `ios/` (generated by `npx cap add ios`)
- Create: `android/` (generated by `npx cap add android`)
- Modify: `package.json` (new dependencies + npm scripts)
- Modify: `.gitignore` (verify native build-artifact excludes are present)

**Interfaces:**
- Consumes: nothing from existing app code.
- Produces: `capacitor.config.ts`'s exported `CapacitorConfig` object (read by no other file in
  this plan — Capacitor's own CLI reads it directly), and two npm scripts, `cap:sync:prod` and
  `cap:sync:dev`, referenced in Task 9's runbook.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev @capacitor/cli cross-env
npm install @capacitor/core @capacitor/ios @capacitor/android @capacitor/app @capacitor/status-bar @capacitor/splash-screen
```

(`cross-env` is needed because this repo's scripts must run on both the agent's Windows shell and
the user's Mac — the native `VAR=x command` env-var syntax used in Task 2's later scripts fails on
Windows without it.)

- [ ] **Step 2: Write `capacitor.config.ts`**

Create `capacitor.config.ts` at the repo root:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

// server.url is switched via the CAPACITOR_TARGET env var at `npx cap sync` time - 'prod' points
// the native shell at the public production origin (used for real store builds), 'dev' at the
// staging origin (used for internal test builds on a physical device before cutting a store
// release), matching this project's established dev-first deployment workflow.
const TARGET: 'prod' | 'dev' = process.env.CAPACITOR_TARGET === 'dev' ? 'dev' : 'prod';

const ORIGINS: Record<'prod' | 'dev', string> = {
  prod: 'https://app-17.bfkdo-stpoelten.at',
  dev: 'https://dev.app-17.bfkdo-stpoelten.at',
};

const config: CapacitorConfig = {
  appId: 'at.bfkdostpoelten.app',
  appName: 'APP-17',
  // Kein lokal gebündeltes web-dir - die WebView lädt die live gehostete Origin direkt (siehe
  // docs/superpowers/specs/2026-08-23-capacitor-store-rollout-design.md: kein Rewrite der
  // Server-Actions-/Session-Architektur). webDir bleibt trotzdem gesetzt, weil Capacitors CLI
  // einen Wert erwartet, auch wenn dessen Inhalt hier nie tatsächlich ausgeliefert wird.
  webDir: 'public',
  server: {
    url: ORIGINS[TARGET],
    cleartext: false,
    errorPath: 'offline.html',
  },
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#1c1c1e',
    },
  },
};

export default config;
```

- [ ] **Step 3: Add native platforms**

```bash
npx cap add ios
npx cap add android
```

If either command fails in this environment (e.g. `cap add android` requiring Android SDK tooling
not installed here), stop and report the exact error — this step then needs to run on the user's
machine instead, and every later step touching `ios/`/`android/` in this plan is blocked until it
does.

- [ ] **Step 4: Add npm scripts**

Read `package.json` first. In its `"scripts"` object, add:

```json
"cap:sync:prod": "cross-env CAPACITOR_TARGET=prod npx cap sync",
"cap:sync:dev": "cross-env CAPACITOR_TARGET=dev npx cap sync",
"cap:open:ios": "npx cap open ios",
"cap:open:android": "npx cap open android"
```

- [ ] **Step 5: Confirm what's committed**

Run `git status` and confirm nothing under `ios/App/Pods/`, `ios/App/DerivedData/`,
`android/.gradle/`, `android/app/build/`, or `android/local.properties` is staged (Capacitor's
`cap add` generates a `.gitignore` inside each platform folder covering these — verify it's
actually taking effect rather than assuming it).

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm run cap:sync:dev
```

`cap sync` should complete and report both platforms synced without error.

- [ ] **Step 7: Commit**

```bash
git add capacitor.config.ts package.json package-lock.json .gitignore ios android
git commit -m "feat: initialize Capacitor iOS/Android projects (remote-URL WebView shell)"
```

---

### Task 3: Android hardware back-button handling

**Files:**
- Create: `src/components/capacitor/android-back-button.tsx`
- Modify: `src/app/(app)/layout.tsx:57-60` (mount the component once, app-wide)

**Interfaces:**
- Consumes: `Capacitor` from `@capacitor/core` (`isNativePlatform()`, `getPlatform()`); `App` from
  `@capacitor/app` (`addListener('backButton', ...)`, `exitApp()`); `useRouter` from
  `next/navigation`.
- Produces: nothing consumed by later tasks — this is a leaf, side-effect-only component.

- [ ] **Step 1: Write the component**

Create `src/components/capacitor/android-back-button.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';

/**
 * Android's hardware back button has no browser equivalent - without this, Capacitor's default
 * behavior on Android is to exit the app on back-press instead of navigating the WebView's own
 * history, which would make every list->detail->list flow in this app feel broken on Android.
 * No-ops entirely on iOS/web.
 */
export function AndroidBackButton() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let listenerHandle: { remove: () => void } | undefined;

    import('@capacitor/app').then(({ App }) => {
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          router.back();
        } else {
          App.exitApp();
        }
      }).then((handle) => {
        listenerHandle = handle;
      });
    });

    return () => listenerHandle?.remove();
  }, [router]);

  return null;
}
```

- [ ] **Step 2: Mount it in the app shell**

Read `src/app/(app)/layout.tsx` first. Import `AndroidBackButton` from
`@/components/capacitor/android-back-button`, and render `<AndroidBackButton />` as the first child
inside the root `<div className="flex min-h-screen flex-col bg-[#f6f6f7]">`, immediately before the
`<header>` element — a sibling of the header, not nested inside it or any conditional block, so it
mounts on every authenticated page exactly once.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
```

Real back-button behavior cannot be verified without an Android build — that check is
`⚠️ USER-ONLY`, covered in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/components/capacitor/android-back-button.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: handle Android hardware back button via WebView history"
```

---

### Task 4: Status bar theming + splash screen hide

**Files:**
- Create: `src/components/capacitor/native-shell-init.tsx`
- Modify: `src/app/layout.tsx:1-4,70` (mount the component once, root-level)

**Interfaces:**
- Consumes: `Capacitor` from `@capacitor/core` (`isNativePlatform()`); `StatusBar`, `Style` from
  `@capacitor/status-bar`; `SplashScreen` from `@capacitor/splash-screen`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the component**

Create `src/components/capacitor/native-shell-init.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Runs once, app-wide, on native platforms only. Matches the status bar to the app's existing
 * dark header (#1c1c1e, the same value as viewport.themeColor in this same layout.tsx and
 * manifest.ts's theme_color) and hides the native splash screen once the WebView has actually
 * finished loading the remote origin - launchAutoHide is false in capacitor.config.ts specifically
 * so this explicit hide() is what ends the splash, not a fixed timer that might hide it before the
 * page is actually ready.
 */
export function NativeShellInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    Promise.all([import('@capacitor/status-bar'), import('@capacitor/splash-screen')]).then(
      ([{ StatusBar, Style }, { SplashScreen }]) => {
        StatusBar.setBackgroundColor({ color: '#1c1c1e' }).catch(() => {});
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        SplashScreen.hide().catch(() => {});
      },
    );
  }, []);

  return null;
}
```

- [ ] **Step 2: Mount it in the root layout**

Read `src/app/layout.tsx` first. Add `import { NativeShellInit } from
'@/components/capacitor/native-shell-init';` alongside the existing `PwaRegister` import, and
render `<NativeShellInit />` inside `<body>`, next to the existing `<PwaRegister />` line:

```tsx
<PwaRegister />
<NativeShellInit />
{children}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
```

Visual confirmation (status bar color, splash screen timing) requires a real device build —
`⚠️ USER-ONLY`, covered in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/components/capacitor/native-shell-init.tsx src/app/layout.tsx
git commit -m "feat: theme native status bar and hide splash screen on load"
```

---

### Task 5: Disable the custom service worker inside the native shell

**Files:**
- Modify: `src/components/pwa-register.tsx` (entire file, currently 15 lines)

**Interfaces:**
- Consumes: `Capacitor` from `@capacitor/core` (`isNativePlatform()`).
- Produces: nothing new — narrows an existing effect's condition; no other task depends on this
  file's contents.

- [ ] **Step 1: Read the current file**

Read `src/components/pwa-register.tsx` in full (required before editing) — it currently reads:

```tsx
'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registrierung ist best-effort; ohne SW funktioniert die App normal weiter.
      });
    }
  }, []);

  return null;
}
```

- [ ] **Step 2: Guard the registration**

Replace its contents with:

```tsx
'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export function PwaRegister() {
  useEffect(() => {
    // Die native Capacitor-Hülle übernimmt bereits die "installierte App"-Rolle (eigener
    // Prozess, eigenes Icon, eigener Splash-Screen) - ein zusätzlich registrierter Service Worker
    // in derselben WebView würde nur riskieren, gegen zwei konkurrierende Install-Mechanismen
    // ohne klare Update-Präzedenz zu cachen. Einfachste sichere Wahl: pro Installationsweg nur
    // einer der beiden.
    if (Capacitor.isNativePlatform()) return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registrierung ist best-effort; ohne SW funktioniert die App normal weiter.
      });
    }
  }, []);

  return null;
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pwa-register.tsx
git commit -m "fix: skip custom service worker registration inside the native Capacitor shell"
```

---

### Task 6: iOS permission strings

**Files:**
- Modify: `ios/App/App/Info.plist` (generated by Task 2 — this task cannot start until Task 2's
  `npx cap add ios` has actually produced this file)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks — standalone native-config fix.

- [ ] **Step 1: Read the generated Info.plist**

Read `ios/App/App/Info.plist` in full. It's a standard Capacitor-generated property list — a
top-level `<dict>` of `<key>`/`<string>` (or other value type) pairs.

- [ ] **Step 2: Add camera/photo-library usage strings**

Inside the top-level `<dict>`, add (if not already present):

```xml
<key>NSCameraUsageDescription</key>
<string>Wird benötigt, um Fotos direkt beim Fotoupload aufzunehmen.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Wird benötigt, um vorhandene Fotos für den Fotoupload auszuwählen.</string>
```

Without these, iOS silently refuses the camera/photo-library prompt triggered by the existing
`<input type="file">` element in the app's photo-upload form (`src/app/(app)/foto-uploads/`) — the
picker sheet never appears, with no visible error.

- [ ] **Step 3: Verify**

This is a plain XML edit — confirm the file still parses as valid XML (e.g. `python -c
"import xml.etree.ElementTree as ET; ET.parse('ios/App/App/Info.plist')"` or any XML linter
available). Full behavioral verification (does the picker actually appear) is `⚠️ USER-ONLY`,
covered in Task 9.

- [ ] **Step 4: Commit**

```bash
git add ios/App/App/Info.plist
git commit -m "fix: add iOS camera/photo-library usage descriptions for photo upload"
```

---

### Task 7: App icons and splash screen assets

**Files:**
- Create: `assets/icon.png`, `assets/splash.png` (source images, not committed — see step 4)
- Create (generated, committed): `ios/App/App/Assets.xcassets/AppIcon.appiconset/*`,
  `ios/App/App/Assets.xcassets/Splash.imageset/*`,
  `android/app/src/main/res/mipmap-*/ic_launcher*.png`,
  `android/app/src/main/res/drawable*/splash.png`

**Interfaces:**
- Consumes: `public/wappen-bfkdo.png` (existing 1030×1030 source artwork, already used to generate
  the PWA icon set — see root `CLAUDE.md`'s Bezirk-17-rebrand section).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Install the asset generator**

```bash
npm install --save-dev @capacitor/assets
```

- [ ] **Step 2: Generate the two source images**

Capacitor's assets tool expects `assets/icon.png` (1024×1024, no transparency — iOS App Icons
reject alpha channels) and `assets/splash.png` (2732×2732, logo centered with padding) at the repo
root's `assets/` folder. Generate both from `public/wappen-bfkdo.png` with a short one-off script
(same throwaway-script convention already used for the PWA icon regeneration, documented in root
`CLAUDE.md` — not committed): composite the Wappen onto a solid white background at 1024×1024 for
`icon.png`, and onto a solid `#1c1c1e` background (matching `capacitor.config.ts`'s
`SplashScreen.backgroundColor` from Task 2) at 2732×2732, Wappen centered and scaled to roughly a
third of the canvas, for `splash.png`.

- [ ] **Step 3: Generate platform assets**

```bash
npx capacitor-assets generate
```

- [ ] **Step 4: Verify — ⚠️ USER-ONLY**

Open both `npx cap open ios` and `npx cap open android` and confirm the app icon/splash appear
correctly in each IDE's asset catalog preview. The agent can run `capacitor-assets generate`
successfully but cannot visually confirm the output without Xcode/Android Studio — report the
generation command's own success/failure, but do not claim the icons look correct without this
step.

- [ ] **Step 5: Commit**

```bash
git add ios/App/App/Assets.xcassets android/app/src/main/res
git commit -m "feat: generate native app icons and splash screens from Wappen artwork"
```

(`assets/icon.png`/`assets/splash.png` and the one-off generation script are not committed,
matching the existing PWA-icon convention — add `assets/` to `.gitignore` in this same commit if
not already covered.)

---

### Task 8: Offline fallback screen

**Files:**
- Create: `native-fallback/offline.html`
- Create: `ios/App/App/public/offline.html` (copy of the above)
- Create: `android/app/src/main/assets/public/offline.html` (copy of the above)
- Modify: `capacitor.config.ts` (already references `errorPath: 'offline.html'` from Task 2 step
  2 — no further change needed here, listed for completeness)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the fallback page**

Create `native-fallback/offline.html` (a new top-level folder — this file is never served by the
Next.js app, only bundled directly into each native project):

```html
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
         font-family:-apple-system,Roboto,sans-serif; background:#1c1c1e; color:#fff; text-align:center; padding:24px; }
  button { margin-top:16px; padding:10px 20px; border-radius:8px; border:none; background:#e4322b; color:#fff; font-size:15px; }
</style>
</head>
<body>
  <p>Keine Verbindung zum Server.<br>Bitte Internetverbindung prüfen.</p>
  <button onclick="location.reload()">Erneut versuchen</button>
</body>
</html>
```

- [ ] **Step 2: Copy it into both native projects**

```bash
cp native-fallback/offline.html ios/App/App/public/offline.html
cp native-fallback/offline.html android/app/src/main/assets/public/offline.html
```

(Both native projects already have a `public/`-style asset folder from Task 2's `cap add` — this
file is added alongside whatever Capacitor generated there, not replacing anything.)

- [ ] **Step 3: Verify**

Confirm `capacitor.config.ts`'s `server.errorPath` is set to `'offline.html'` (already done in Task
2 step 2). Confirm both copied files are byte-identical to `native-fallback/offline.html`:

```bash
diff native-fallback/offline.html ios/App/App/public/offline.html
diff native-fallback/offline.html android/app/src/main/assets/public/offline.html
```

Both should produce no output. Actually triggering the fallback (airplane mode on a real
device/simulator) is `⚠️ USER-ONLY`, covered in Task 9.

- [ ] **Step 4: Commit**

```bash
git add native-fallback ios/App/App/public/offline.html android/app/src/main/assets/public/offline.html
git commit -m "feat: add offline fallback screen for native shell connectivity loss"
```

---

### Task 9: End-to-end device verification — ⚠️ USER-ONLY (entire task)

**Files:** none — verification only. This entire task requires the user's own Mac (for iOS) and an
Android emulator or device; no step in it can be executed or its result confirmed by the agent.

- [ ] **Step 1: Build and run the dev-target app on both platforms**

```bash
npm run cap:sync:dev
npm run cap:open:ios      # then Run in Xcode on a simulator or a real device
npm run cap:open:android  # then Run in Android Studio on an emulator or a real device
```

- [ ] **Step 2: Walk through the core flows on each platform**

Login (both the Passwort and E-Mail-Token tabs), Kalender (view + create an event), Drohnengruppe
flight registration (confirms the pilot/drone dropdowns render correctly in the WebView),
Foto-Upload (confirms Task 6's iOS camera/photo-library prompt actually appears and a photo can be
selected), Meine Feuerwehr / Fahrzeug-Reservierung. Confirm the Android hardware back button
(Task 3) navigates within the app instead of exiting, and that the status bar color/splash screen
(Task 4) look correct.

- [ ] **Step 3: Test the offline fallback**

Enable airplane mode mid-session, confirm Task 8's fallback screen appears (not a blank screen or
raw browser error page), re-enable connectivity, confirm "Erneut versuchen" recovers the real app.

- [ ] **Step 4: Re-run against the prod target**

```bash
npm run cap:sync:prod
```

Repeat a shortened version of Step 2 (login + one core flow per module) against the production
origin — this is the actual configuration that ships to the stores.

- [ ] **Step 5: Record findings**

No commit for this task. If any step fails, that failure is a bug against the specific earlier
task that introduced it (e.g. a broken photo picker → revisit Task 6), fixed there, then this task
is re-run from Step 1.
