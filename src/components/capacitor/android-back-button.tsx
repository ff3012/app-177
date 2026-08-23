'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';

/**
 * Android's hardware back button has no browser equivalent. Verified against the actual
 * @capacitor/app Android plugin source: with NO JS listener registered, Capacitor's own default
 * behavior on back-press is "if the WebView can go back, go back - otherwise do nothing", i.e. the
 * press is silently swallowed once WebView history is exhausted (the app does NOT exit on its
 * own). Without this component, a user at the root of WebView history (e.g. /login,
 * /drohnen-schnell/[token], right after a fresh launch) who presses back gets nothing - the app
 * appears frozen, not exitable. This component's real job is providing the missing
 * App.exitApp() call at that point; secondarily, it also routes in-app back navigation through
 * Next's router instead of raw WebView history for a more predictable list->detail->list flow.
 * No-ops entirely on iOS/web.
 */
export function AndroidBackButton() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let listenerHandle: { remove: () => void } | undefined;
    let cancelled = false;

    import('@capacitor/app')
      .then(({ App }) => {
        App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) {
            router.back();
          } else {
            App.exitApp();
          }
        }).then((handle) => {
          if (cancelled) {
            handle.remove();
            return;
          }
          listenerHandle = handle;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      listenerHandle?.remove();
    };
  }, [router]);

  return null;
}
