'use client';

import { useEffect, useState } from 'react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { savePushSubscription, deletePushSubscription } from '@/app/(app)/profile/push-actions';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function PushNotificationsToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    setSupported(true);
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => {});
  }, []);

  async function handleToggle(next: boolean) {
    setError(undefined);
    if (!vapidPublicKey) {
      setError('Push-Benachrichtigungen sind serverseitig noch nicht konfiguriert.');
      return;
    }

    setPending(true);
    try {
      const registration = await navigator.serviceWorker.ready;

      if (next) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setError('Berechtigung für Benachrichtigungen wurde nicht erteilt.');
          return;
        }
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          throw new Error('Unvollständige Push-Subscription vom Browser erhalten.');
        }
        await savePushSubscription({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
        setEnabled(true);
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await deletePushSubscription(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setEnabled(false);
      }
    } catch (err) {
      console.error('Push-Benachrichtigungen konnten nicht geändert werden:', err);
      setError('Push-Benachrichtigungen konnten nicht geändert werden.');
    } finally {
      setPending(false);
    }
  }

  if (!supported) {
    const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      return (
        <p className="text-xs text-neutral-500">
          Push-Benachrichtigungen sind auf iPhone/iPad nur verfügbar, wenn die App über "Zum Home-Bildschirm"
          installiert wurde.
        </p>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <ToggleSwitch label="Push-Benachrichtigungen" checked={enabled} onChange={handleToggle} />
      {pending && <p className="text-xs text-neutral-500">Wird aktualisiert…</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
