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
