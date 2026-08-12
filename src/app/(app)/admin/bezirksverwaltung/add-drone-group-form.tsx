'use client';

import { useActionState } from 'react';
import { createDroneGroup, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function AddDroneGroupForm({ abschnitte }: { abschnitte: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createDroneGroup, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="dronegroup-name" className="text-sm font-medium text-neutral-700">
          Name
        </label>
        <input id="dronegroup-name" name="name" required placeholder="Drohnengruppe Neu" className="rounded border border-neutral-300 px-3 py-2" />
        {state.fieldErrors?.name && <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="dronegroup-organizationId" className="text-sm font-medium text-neutral-700">
          Anker-Abschnitt
        </label>
        <select id="dronegroup-organizationId" name="organizationId" required className="rounded border border-neutral-300 px-3 py-2">
          {abschnitte.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.organizationId && <p className="text-xs text-red-700">{state.fieldErrors.organizationId[0]}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : 'Anlegen'}
      </button>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
