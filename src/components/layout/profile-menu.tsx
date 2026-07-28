'use client';

import { useEffect, useRef, useState } from 'react';
import { ChangePasswordForm } from './change-password-form';

interface ProfileMenuProps {
  name: string;
  email: string;
  homeOrganizationName: string;
  isSiteAdmin: boolean;
  adminOrganizationNames: string[];
  isDrohnengruppeMember: boolean;
}

export function ProfileMenu({
  name,
  email,
  homeOrganizationName,
  isSiteAdmin,
  adminOrganizationNames,
  isDrohnengruppeMember,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setChangingPassword(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const adminLabel = isSiteAdmin
    ? 'Abschnittskommando-Admin'
    : adminOrganizationNames.length > 0
      ? `Admin für: ${adminOrganizationNames.join(', ')}`
      : 'Keine Admin-Rechte';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="max-w-[8rem] truncate rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100 sm:max-w-none"
      >
        {name}
      </button>

      {open && (
        <div className="fixed inset-x-4 top-16 z-20 w-auto rounded-lg border border-neutral-200 bg-white p-4 text-sm shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-72">
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
            {changingPassword ? (
              <ChangePasswordForm />
            ) : (
              <button
                type="button"
                onClick={() => setChangingPassword(true)}
                className="text-sm font-medium text-brand hover:underline"
              >
                Passwort ändern
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
