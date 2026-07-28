'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveDroneFlightEmail, type DroneFlightEmailState } from './actions';

const initialState: DroneFlightEmailState = {};

export function DroneFlightEmailForm({ initialEmail }: { initialEmail: string }) {
  const [state, formAction, pending] = useActionState(saveDroneFlightEmail, initialState);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="droneFlightEmail" className="text-sm font-medium text-neutral-700">
          Drohnenflug E-Mail
        </label>
        <input
          id="droneFlightEmail"
          name="email"
          type="email"
          required
          defaultValue={initialEmail}
          onChange={() => setDirty(true)}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <p className="text-xs text-neutral-500">
          An diese Adresse wird bei jeder Registrierung eines neuen Drohnenflugs eine Benachrichtigung gesendet.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className={`self-start rounded px-4 py-2 font-medium text-white disabled:opacity-60 ${
          saved ? 'bg-green-600 hover:bg-green-700' : 'bg-neutral-500 hover:bg-neutral-600'
        }`}
      >
        {pending ? 'Wird gespeichert…' : saved ? 'Gespeichert' : 'Speichern'}
      </button>
    </form>
  );
}
