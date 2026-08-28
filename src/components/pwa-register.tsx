'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export function PwaRegister() {
  useEffect(() => {
    // Android registriert den Service Worker jetzt ebenfalls (siehe
    // docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md, "Service-Worker-
    // Registrierung auf Android") - eng gefasst auf einen reinen Offline-Fallback-Cache (siehe
    // sw.js), um die ursprüngliche Sorge (zwei konkurrierende Installationsmechanismen) nicht
    // wieder einzuführen. iOS bleibt ausgenommen: dort übernimmt weiterhin ausschließlich die
    // native Capacitor-Hülle die "installierte App"-Rolle - kein Offline-Kalender-Pilot für iOS.
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registrierung ist best-effort; ohne SW funktioniert die App normal weiter.
      });
    }
  }, []);

  return null;
}
