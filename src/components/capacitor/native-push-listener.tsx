'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { saveFcmToken } from '@/app/(app)/profile/push-actions';
import { NATIVE_PUSH_ENABLED_KEY } from '@/components/layout/push-notifications-toggle';

/**
 * Empfängt native Android-Push-Benachrichtigungen: im Vordergrund als Toast (die App zeigt sonst
 * keine System-Benachrichtigung, während sie bereits offen ist), und navigiert bei einem Tap auf
 * eine (aus dem Hintergrund/geschlossen empfangene) Benachrichtigung per Next-Router zu data.url -
 * dieselbe data.url, die News/Kalender-Push serverseitig schon für den Web-Push-Fall setzen (siehe
 * public/sw.js's notificationclick). No-op auf iOS/Web.
 */
export function NativePushListener() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let cancelled = false;
    let receivedHandle: { remove: () => void } | undefined;
    let actionHandle: { remove: () => void } | undefined;
    let registrationHandle: { remove: () => void } | undefined;

    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        toast(notification.title ?? 'Neue Benachrichtigung', {
          description: notification.body,
        });
      }).then((handle) => {
        if (cancelled) {
          handle.remove();
          return;
        }
        receivedHandle = handle;
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action.notification.data?.url;
        if (typeof url === 'string' && url.length > 0) {
          router.push(url);
        }
      }).then((handle) => {
        if (cancelled) {
          handle.remove();
          return;
        }
        actionHandle = handle;
      });

      // Finding B (final-review): FCM kann den Geräte-Token jederzeit rotieren
      // (MessagingService.java's onNewToken feuert ein "retained" registration-Event - auch ein
      // erst später angehängter Listener wie dieser hier bekommt es noch). Ohne diesen Listener
      // wird ein rotierter Token nie erneut gespeichert und Push verstummt still und dauerhaft für
      // dieses Gerät, obwohl der Toggle weiter "aktiviert" zeigt. Nur speichern, wenn der Nutzer
      // Push tatsächlich aktiviert hat (dasselbe Flag, das ProfileMenu/PushNotificationsToggle
      // verwenden) - saveFcmToken ist serverseitig ein Upsert, also idempotent bei doppeltem Aufruf.
      PushNotifications.addListener('registration', (token) => {
        let optedIn = false;
        try {
          optedIn = localStorage.getItem(NATIVE_PUSH_ENABLED_KEY) === 'true';
        } catch {
          optedIn = false;
        }
        if (!optedIn) return;
        saveFcmToken(token.value).catch((err) => {
          console.error('Konnte rotierten FCM-Token nicht speichern:', err);
        });
      }).then((handle) => {
        if (cancelled) {
          handle.remove();
          return;
        }
        registrationHandle = handle;
      });
    });

    return () => {
      cancelled = true;
      receivedHandle?.remove();
      actionHandle?.remove();
      registrationHandle?.remove();
    };
  }, [router]);

  return null;
}
