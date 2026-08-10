'use client';

import { useActionState } from 'react';
import type { DroneFormState } from './actions';

const initialState: DroneFormState = {};

/** `action` kommt jetzt vorgebunden (createDrone.bind(null, droneGroupId)) von der aufrufenden
 * Seite statt hier einen fixen, ungruppierten Import zu verwenden - jede Drohnengruppe hat ihr
 * eigenes Formular mit ihrer eigenen droneGroupId. */
export function AddDroneForm({
  action,
}: {
  action: (state: DroneFormState, formData: FormData) => Promise<DroneFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium text-neutral-700">
          Neue Drohne (Name)
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="z. B. Drohne 3"
          className="rounded border border-neutral-300 px-3 py-2"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : 'Hinzufügen'}
      </button>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
