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
