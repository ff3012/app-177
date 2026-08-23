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
  // Server-Actions-/Session-Architektur). webDir zeigt trotzdem auf den schlanken Ordner
  // native-fallback/ (enthält nur offline.html), damit `cap sync`s Copy-from-webDir-Schritt genau
  // die richtige, versionierte offline.html ausliefert (als errorPath-Ziel unten, siehe Fix 1 im
  // finalen Whole-Branch-Review) statt versehentlich etwas aus dem Next.js public/-Ordner
  // aufzugreifen - der ist viel größer und enthält unzusammenhängende PWA-Assets, die nicht für
  // das native Bundle gedacht sind.
  webDir: 'native-fallback',
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
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#1c1c1e',
    },
  },
};

export default config;
