'use client';

import { useActionState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  setGoogleCalendarCredentials,
  removeGoogleCalendarCredentials,
  type GoogleCalendarConfigState,
} from './actions';

const initialState: GoogleCalendarConfigState = {};

interface GoogleCalendarConfigFormProps {
  organizationId: string;
  initialCalendarId: string;
  /** NUR ob Zugangsdaten hinterlegt sind, NIEMALS das Service-Account-JSON selbst - siehe
   * DashboardFacebookConfigForm für dasselbe Prinzip beim Facebook Access Token. */
  hasCredentials: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/**
 * Lädt eine Google-Service-Account-JSON-Datei hoch (Schreibzugriff auf einen Google Kalender) - die
 * Gegenrichtung zum bestehenden ICS-Import. Siehe
 * docs/superpowers/specs/2026-08-04-google-calendar-push-sync-design.md.
 */
export function GoogleCalendarConfigForm({
  organizationId,
  initialCalendarId,
  hasCredentials,
  lastSyncAt,
  lastSyncError,
}: GoogleCalendarConfigFormProps) {
  const [state, formAction, pending] = useActionState(
    setGoogleCalendarCredentials.bind(null, organizationId),
    initialState,
  );
  const [removing, startRemoving] = useTransition();

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="googleCalendarServiceAccountFile" className="text-[13px] font-medium text-ink">
            Service-Account-Schlüsseldatei (JSON)
          </label>
          <input
            id="googleCalendarServiceAccountFile"
            name="file"
            type="file"
            accept="application/json"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          />
          <p className="text-xs text-ink-faint">
            Nur für Google Kalender möglich - lade die JSON-Schlüsseldatei deines Google-Service-Accounts
            hoch. Der Service-Account muss als Bearbeiter für den Zielkalender freigegeben sein.
            {hasCredentials && ' Datei leer lassen, um die bereits hinterlegten Zugangsdaten zu behalten.'}
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="googleCalendarId" className="text-[13px] font-medium text-ink">
            Google Kalender-ID
          </label>
          <input
            id="googleCalendarId"
            name="googleCalendarId"
            type="text"
            defaultValue={initialCalendarId}
            placeholder="xxx@group.calendar.google.com"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Wird geprüft…' : 'Speichern'}
        </button>
        {hasCredentials && (
          <button
            type="button"
            disabled={removing}
            onClick={() =>
              startRemoving(async () => {
                await removeGoogleCalendarCredentials(organizationId);
                toast.success('Google-Kalender-Zugangsdaten entfernt.');
              })
            }
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-60"
          >
            Entfernen
          </button>
        )}
      </form>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2 text-xs text-ink-faint">
        <span>Hinterlegt: {hasCredentials ? 'Ja' : 'Nein'}</span>
        {hasCredentials && (
          <span>
            {lastSyncError
              ? `Zuletzt fehlgeschlagen: ${lastSyncError}`
              : lastSyncAt
                ? `Zuletzt synchronisiert: ${new Date(lastSyncAt).toLocaleString('de-AT')}`
                : 'Noch kein Termin übertragen.'}
          </span>
        )}
      </div>
    </div>
  );
}
