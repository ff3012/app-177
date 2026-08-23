'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Runs once, app-wide, on native platforms only. Matches the status bar to the app's existing
 * dark header (#1c1c1e, the same value as viewport.themeColor in this same layout.tsx and
 * manifest.ts's theme_color) and hides the native splash screen once the WebView has actually
 * finished loading the remote origin. capacitor.config.ts sets launchShowDuration: 3000 and
 * launchAutoHide: true, so the platform itself guarantees the splash is auto-dismissed after 3s no
 * matter what (a real backstop - e.g. if the WebView never hydrates, such as the offline-fallback
 * page, which has no access to Capacitor plugins and can never call hide()). This explicit hide()
 * call is a "hide early once actually ready" optimization layered on top of that backstop, not the
 * sole mechanism that ends the splash.
 */
export function NativeShellInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    Promise.all([import('@capacitor/status-bar'), import('@capacitor/splash-screen')])
      .then(([{ StatusBar, Style }, { SplashScreen }]) => {
        StatusBar.setBackgroundColor({ color: '#1c1c1e' }).catch(() => {});
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        SplashScreen.hide().catch(() => {});
      })
      .catch(() => {});
  }, []);

  return null;
}
