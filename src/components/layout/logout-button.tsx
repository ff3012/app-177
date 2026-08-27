'use client';

import { useTransition, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { deleteFcmToken } from '@/app/(app)/profile/push-actions';
import { NATIVE_PUSH_ENABLED_KEY, registerForFcmToken } from './push-notifications-toggle';

interface LogoutButtonProps {
  logoutAction: () => Promise<void>;
  className: string;
  children: ReactNode;
}

// Ersetzt das frühere <form action={logoutAction}> an beiden Stellen (Desktop-Header in
// (app)/layout.tsx, mobiles Dropdown in ProfileMenu): auf nativem Android muss der FcmToken dieses
// Geräts VOR dem eigentlichen signOut() serverseitig gelöscht werden, weil deleteFcmToken() intern
// requireUser() aufruft - nach signOut() gäbe es keine Session mehr, die den Aufruf autorisiert.
// Ein gemeinsam genutztes Gerät (z. B. ein Feuerwehrhaus-Tablet) würde sonst weiter Push-Nachrichten
// des vorigen Nutzers erhalten. Rein best-effort: jeder Fehler beim nativen Cleanup wird geloggt,
// blockiert aber nie den eigentlichen Logout.
export function LogoutButton({ logoutAction, className, children }: LogoutButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        try {
          let wasEnabled = false;
          try {
            wasEnabled = localStorage.getItem(NATIVE_PUSH_ENABLED_KEY) === 'true';
          } catch {
            wasEnabled = false;
          }
          if (wasEnabled) {
            const { PushNotifications } = await import('@capacitor/push-notifications');
            const token = await registerForFcmToken(PushNotifications);
            await deleteFcmToken(token);
            try {
              localStorage.removeItem(NATIVE_PUSH_ENABLED_KEY);
            } catch (storageErr) {
              console.error('Konnte Push-Status nicht aus localStorage entfernen:', storageErr);
            }
          }
        } catch (err) {
          console.error('FCM-Token konnte beim Abmelden nicht entfernt werden:', err);
        }
      }
      await logoutAction();
    });
  }

  return (
    <button type="button" onClick={handleClick} disabled={pending} className={className}>
      {children}
    </button>
  );
}
