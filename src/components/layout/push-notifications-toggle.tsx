'use client';

import { useState } from 'react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { savePushSubscription, deletePushSubscription } from '@/app/(app)/profile/push-actions';

// Uint8Array.from(...) infers a Uint8Array<ArrayBufferLike>, which the DOM types no longer accept
// for PushManager.subscribe's applicationServerKey. Build via `new Uint8Array(length)` instead so
// the backing buffer stays a concrete ArrayBuffer.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface PushNotificationsToggleProps {
  vapidPublicKey: string | null;
  supported: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

/** Kontrolliert von ProfileMenu (das den Status auch für das Glocken-Icon in der Kopfzeile braucht). */
export function PushNotificationsToggle({
  vapidPublicKey,
  supported,
  enabled,
  onEnabledChange,
}: PushNotificationsToggleProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
        onEnabledChange(true);
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await deletePushSubscription(subscription.endpoint);
          await subscription.unsubscribe();
        }
        onEnabledChange(false);
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
