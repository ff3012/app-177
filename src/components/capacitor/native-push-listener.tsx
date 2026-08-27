'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';

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
    });

    return () => {
      cancelled = true;
      receivedHandle?.remove();
      actionHandle?.remove();
    };
  }, [router]);

  return null;
}
