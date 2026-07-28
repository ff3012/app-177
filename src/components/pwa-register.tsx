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
