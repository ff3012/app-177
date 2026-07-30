'use client';

import { useEffect, useRef, useState } from 'react';
import { ChangePasswordForm } from './change-password-form';
import { FeedbackForm } from './feedback-form';
import { PushNotificationsToggle } from './push-notifications-toggle';

type ProfilePanel = 'password' | 'feedback' | null;

interface ProfileMenuProps {
  name: string;
  email: string;
  homeOrganizationName: string;
  isSiteAdmin: boolean;
  adminOrganizationNames: string[];
  isDrohnengruppeMember: boolean;
  vapidPublicKey: string | null;
}

export function ProfileMenu({
  name,
  email,
  homeOrganizationName,
  isSiteAdmin,
  adminOrganizationNames,
  isDrohnengruppeMember,
  vapidPublicKey,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<ProfilePanel>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={pushEnabled ? 'Push-Benachrichtigungen aktiv' : 'Push-Benachrichtigungen inaktiv'}
        title={pushEnabled ? 'Push-Benachrichtigungen aktiv' : 'Push-Benachrichtigungen inaktiv'}
        className={`rounded p-1.5 hover:bg-white/10 ${pushEnabled ? 'text-green-400' : 'text-red-400'}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 21a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="max-w-[8rem] truncate rounded px-2 py-1 text-sm text-neutral-200 hover:bg-white/10 sm:max-w-none"
      >
        {name}
      </button>

      {open && (
        // z-40: above the mobile bottom tab bar (z-30) - on short screens this dropdown (with the
        // push toggle expanded) can reach far enough down to otherwise sit under the tab bar.
        <div className="fixed inset-x-4 top-16 z-40 w-auto rounded-lg border border-neutral-200 bg-white p-4 text-sm shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-72">
          <p className="font-semibold text-neutral-900">{name}</p>
          <p className="text-neutral-500">{email}</p>

          <dl className="mt-3 flex flex-col gap-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
              <dd className="text-neutral-800">{homeOrganizationName}</dd>
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
        </div>
      )}
    </div>
  );
}
