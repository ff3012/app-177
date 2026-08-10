'use client';

import { useActionState, useEffect, useState } from 'react';
import { setFlightNotificationEmail, type DroneGroupEmailState } from './actions';

const initialState: DroneGroupEmailState = {};

/** Ersetzt die frühere singleton-weite "Drohnenflug E-Mail" auf /admin/email (siehe
 * saveDroneFlightEmail-Entfernung, Task 9) - jetzt pro Drohnengruppe hier direkt editierbar, analog
 * zu AtemschutzSachbearbeiterForm (admin/heimatfeuerwehr). Leer lassen = keine Benachrichtigung für
 * diese Gruppe. */
export function DroneGroupEmailForm({ droneGroupId, initialEmail }: { droneGroupId: string; initialEmail: string }) {
  const boundAction = setFlightNotificationEmail.bind(null, droneGroupId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="flightNotificationEmail" className="text-sm font-medium text-ink">
          Drohnenflug E-Mail
        </label>
        <input
          id="flightNotificationEmail"
          name="email"
          type="email"
          defaultValue={initialEmail}
          onChange={() => setDirty(true)}
          placeholder="z. B. drohnen@abschnitt-purkersdorf.at"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <p className="text-xs text-ink-faint">
          An diese Adresse wird bei jeder Registrierung eines neuen Drohnenflugs dieser Gruppe eine
          Benachrichtigung gesendet. Leer lassen für keine Benachrichtigung.
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
          saved ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
        }`}
      >
        {pending ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
      </button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
