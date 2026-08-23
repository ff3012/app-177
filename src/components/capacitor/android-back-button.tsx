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
