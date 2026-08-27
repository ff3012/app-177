'use client';

import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { savePushSubscription, deletePushSubscription, saveFcmToken, deleteFcmToken } from '@/app/(app)/profile/push-actions';

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
  // Token gecacht vom letzten "aktivieren", damit "deaktivieren" (im selben Component-Lifetime)
  // exakt den Token löscht, der tatsächlich serverseitig gespeichert wurde, statt per erneutem
  // PushNotifications.register() einen (im seltenen Rotationsfall abweichenden) neuen zu erhalten.
  // Kein useState, da eine Änderung keinen Re-Render auslösen muss.
  const fcmTokenRef = useRef<string | null>(null);

  async function registerForFcmToken(pushNotifications: typeof import('@capacitor/push-notifications').PushNotifications) {
    return new Promise<string>((resolve, reject) => {
      let registrationHandle: { remove: () => void } | undefined;
      let errorHandle: { remove: () => void } | undefined;
      const cleanup = () => {
        registrationHandle?.remove();
        errorHandle?.remove();
      };
      pushNotifications
        .addListener('registration', (t) => {
          cleanup();
          resolve(t.value);
        })
        .then((handle) => {
          registrationHandle = handle;
        });
      pushNotifications
        .addListener('registrationError', (err) => {
          cleanup();
          reject(err);
        })
        .then((handle) => {
          errorHandle = handle;
        });
      pushNotifications.register();
    });
  }

  async function handleToggle(next: boolean) {
    setError(undefined);
    setPending(true);

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        if (next) {
          const permission = await PushNotifications.requestPermissions();
          if (permission.receive !== 'granted') {
            setError('Berechtigung für Benachrichtigungen wurde nicht erteilt.');
            return;
          }
          const token = await registerForFcmToken(PushNotifications);
          fcmTokenRef.current = token;
          await saveFcmToken(token);
        } else {
          const token = fcmTokenRef.current ?? (await registerForFcmToken(PushNotifications));
          await deleteFcmToken(token);
          fcmTokenRef.current = null;
        }
        onEnabledChange(next);
      } catch (err) {
        console.error('Native Push-Registrierung fehlgeschlagen:', err);
        setError('Push-Benachrichtigungen konnten nicht geändert werden.');
      } finally {
        setPending(false);
      }
      return;
    }

    if (!vapidPublicKey) {
      setError('Push-Benachrichtigungen sind serverseitig noch nicht konfiguriert.');
      setPending(false);
      return;
    }

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
    // Native-App-Nutzer (App/Play Store) können sich nicht per "Zum Home-Bildschirm hinzufügen"
    // in Web-Push-Unterstützung hineinbringen - dieser Rat wäre hier schlicht falsch. Weder iOS
    // WKWebView noch Androids WebView unterstützen die Web-Push-API; ProfileMenu setzt `supported`
    // deshalb innerhalb der Capacitor-Shell nie auf true (siehe dortiger Kommentar).
    if (Capacitor.isNativePlatform()) {
      return (
        <p className="text-xs text-neutral-500">
          Push-Benachrichtigungen sind in dieser App-Version nicht verfügbar.
        </p>
      );
    }
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
