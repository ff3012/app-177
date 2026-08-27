'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Capacitor } from '@capacitor/core';
import { switchHomeOrganization } from '@/app/(app)/switch-organization-action';
import { ChangePasswordForm } from './change-password-form';
import { FeedbackForm } from './feedback-form';
import { PushNotificationsToggle } from './push-notifications-toggle';

type ProfilePanel = 'password' | 'feedback' | 'switch-org' | null;

interface ProfileMenuProps {
  name: string;
  email: string;
  homeOrganizationName: string;
  secondaryOrganizationName: string | null;
  isSiteAdmin: boolean;
  adminOrganizationNames: string[];
  isDrohnengruppeMember: boolean;
  /** Startbildschirm-Brief.md §3: die mobile Tab-Bar hat nur noch 3 feste Einträge (Kalender,
   * Meine Feuerwehr, Drohnengruppe) - News (bislang Teil der permissionsgetriebenen Nav-Liste)
   * braucht auf Mobile deshalb eine neue Anlaufstelle. Desktop erreicht News weiterhin unverändert
   * über <Nav>, daher ist der Link hier unten sm:hidden. */
  canSendAnyNews: boolean;
  unreadNewsCount: number;
  vapidPublicKey: string | null;
  logoutAction: () => Promise<void>;
}

export function ProfileMenu({
  name,
  email,
  homeOrganizationName,
  secondaryOrganizationName,
  isSiteAdmin,
  adminOrganizationNames,
  isDrohnengruppeMember,
  canSendAnyNews,
  unreadNewsCount,
  vapidPublicKey,
  logoutAction,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<ProfilePanel>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Finding 3 (final-review, issue #21): switchHomeOrganization's { error? } war bisher komplett
  // ignoriert (form action={async () => { await switchHomeOrganization(); }}) - eine deaktivierte
  // Ziel-Organisation (Race mit einem Admin, der sie gerade deaktiviert) produzierte keinerlei
  // sichtbare Rückmeldung. pending sichert zusätzlich gegen einen Doppel-Klick ab (Button unten
  // disabled={pending}), switchError wird bei jedem neuen Versuch zurückgesetzt.
  const [switchPending, startSwitchTransition] = useTransition();
  const [switchError, setSwitchError] = useState<string | undefined>();

  function handleConfirmSwitch() {
    setSwitchError(undefined);
    startSwitchTransition(async () => {
      const result = await switchHomeOrganization();
      if (result.error) {
        setSwitchError(result.error);
        return;
      }
      // Erfolg: Panel schließen, statt die jetzt gespiegelte ("Wirklich zu {alte Organisation}
      // wechseln?") Bestätigung weiter anzuzeigen.
      setActivePanel(null);
    });
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActivePanel(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Läuft unabhängig davon, ob das Dropdown offen ist, damit die Glocke in der Kopfzeile immer
  // den richtigen Status (an/aus) zeigt, nicht erst nach dem ersten Öffnen.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // iOS native push is explicitly out of scope (see the design spec) - only Android gets the
      // real FCM flow, iOS keeps showing PushNotificationsToggle's existing "nicht verfügbar" text.
      if (Capacitor.getPlatform() !== 'android') return;
      setPushSupported(true);
      import('@capacitor/push-notifications').then(({ PushNotifications }) => {
        PushNotifications.checkPermissions()
          .then((status) => setPushEnabled(status.receive === 'granted'))
          .catch(() => {});
      });
      return;
    }

    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    setPushSupported(true);
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushEnabled(Boolean(subscription)))
      .catch(() => {});
  }, []);

  const adminLabel = isSiteAdmin
    ? 'Abschnittskommando-Admin'
    : adminOrganizationNames.length > 0
      ? `Admin für: ${adminOrganizationNames.join(', ')}`
      : 'Keine Admin-Rechte';

  return (
    <div className="relative flex items-center gap-1" ref={containerRef}>
      <Link
        href="/news"
        aria-label={
          unreadNewsCount > 0
            ? `${unreadNewsCount} ungelesene Nachrichten - Push-Benachrichtigungen ${pushEnabled ? 'aktiv' : 'inaktiv'}`
            : `Push-Benachrichtigungen ${pushEnabled ? 'aktiv' : 'inaktiv'}`
        }
        title={pushEnabled ? 'Push-Benachrichtigungen aktiv' : 'Push-Benachrichtigungen inaktiv'}
        className={`relative rounded p-1.5 hover:bg-white/10 ${pushEnabled ? 'text-green-400' : 'text-red-400'}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 21a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {unreadNewsCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-[#1c1c1e] bg-brand px-1 text-[10px] font-bold leading-none text-white"
          >
            {unreadNewsCount > 99 ? '99+' : unreadNewsCount}
          </span>
        )}
      </Link>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="hidden max-w-[8rem] truncate rounded px-2 py-1 text-sm text-neutral-200 hover:bg-white/10 sm:inline-flex sm:max-w-none"
      >
        {name}
      </button>
      {/* Mobile-only "Avatar": Initialen-Kreis statt vollem Namenstext, spart Platz in der neuen
          Ein-Zeilen-Kopfleiste (siehe Mobile-Brief.md). Öffnet dasselbe Dropdown wie der Name-Button. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Profilmenü für ${name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white sm:hidden"
      >
        {name.charAt(0).toUpperCase()}
      </button>

      {open && (
        // z-40: above the mobile bottom tab bar (z-30) - on short screens this dropdown (with the
        // push toggle expanded) can reach far enough down to otherwise sit under the tab bar.
        // sm:top-full (not sm:top-auto): this div is an absolutely-positioned child of a
        // `flex items-center` container - with top/bottom both auto, the browser falls back to the
        // CSS static-position algorithm, which centers the box against the ~50px-tall header row's
        // cross-axis. Since the card itself is far taller than that, its top edge landed ~150-200px
        // above the header (off-screen/behind it), so only the lower portion of the card was ever
        // visible - reported as "die Karte ist abgeschnitten" on desktop Chrome. top-full anchors the
        // card's top edge to the bottom edge of the relative container instead (standard
        // dropdown-below-trigger positioning), matching how the mobile fixed-position variant already
        // renders directly under the header.
        <div className="fixed inset-x-4 top-16 z-40 w-auto rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-900 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
          <p className="font-semibold text-neutral-900">{name}</p>
          <p className="text-neutral-500">{email}</p>

          <dl className="mt-3 flex flex-col gap-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
              <dd className="flex flex-wrap items-center gap-2 text-neutral-800">
                {homeOrganizationName}
                {secondaryOrganizationName && (
                  <button
                    type="button"
                    onClick={() => {
                      setSwitchError(undefined);
                      setActivePanel('switch-org');
                    }}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Wechseln zu {secondaryOrganizationName}
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Admin-Rechte</dt>
              <dd className="text-neutral-800">{adminLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Drohnengruppe</dt>
              <dd className="text-neutral-800">{isDrohnengruppeMember ? 'Mitglied' : 'Kein Mitglied'}</dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-neutral-200 pt-3">
            <PushNotificationsToggle
              vapidPublicKey={vapidPublicKey}
              supported={pushSupported}
              enabled={pushEnabled}
              onEnabledChange={setPushEnabled}
            />
          </div>

          <div className="mt-4 border-t border-neutral-200 pt-3">
            {activePanel === 'password' ? (
              <ChangePasswordForm />
            ) : activePanel === 'feedback' ? (
              <FeedbackForm />
            ) : activePanel === 'switch-org' ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-neutral-700">
                  Wirklich zu {secondaryOrganizationName} wechseln? Kalender, Foto-Uploads und Fahrzeug-Reservierung
                  zeigen danach {secondaryOrganizationName}.
                </p>
                {switchError && <p className="text-sm text-red-700">{switchError}</p>}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConfirmSwitch}
                    disabled={switchPending}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
                  >
                    {switchPending ? 'Wird gewechselt…' : 'Bestätigen'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSwitchError(undefined);
                      setActivePanel(null);
                    }}
                    disabled={switchPending}
                    className="text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-60"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <button
                  type="button"
                  onClick={() => setActivePanel('password')}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Passwort ändern
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('feedback')}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Feedback geben
                </button>
              </div>
            )}
          </div>

          {canSendAnyNews && (
            <div className="mt-4 border-t border-neutral-200 pt-3 sm:hidden">
              <Link
                href="/news"
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-brand hover:underline"
              >
                News
              </Link>
            </div>
          )}

          {/* Mobile-only, wie der News-Link oben: die app-weite <Footer/> (mit ihren eigenen
              Datenschutz-/Impressum-Links) wird in (app)/layout.tsx nur ab sm: gerendert - ohne
              diese Links hätte ein eingeloggter Mobile-Nutzer sonst keinen Weg dorthin. */}
          <div className="mt-4 flex gap-3 border-t border-neutral-200 pt-3 sm:hidden">
            <Link
              href="/datenschutz"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-brand hover:underline"
            >
              Datenschutz
            </Link>
            <a
              href="https://bfkdo-stpoelten.at/impressum/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-brand hover:underline"
            >
              Impressum
            </a>
          </div>

          {/* Nur Mobile: Desktop hat "Abmelden" bereits als eigenen Button in der Kopfleiste
              (siehe (app)/layout.tsx) - hier zusätzlich anzeigen würde es doppeln. */}
          <div className="mt-4 border-t border-neutral-200 pt-3 sm:hidden">
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
              >
                Abmelden
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
