'use client';

import { useActionState } from 'react';
import { renameDrone, type DroneFormState } from './actions';

const initialState: DroneFormState = {};

export function RenameDroneForm({ droneId, currentName }: { droneId: string; currentName: string }) {
  const boundRename = renameDrone.bind(null, droneId);
  const [state, formAction, pending] = useActionState(boundRename, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        name="name"
        defaultValue={currentName}
        required
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? '…' : 'Speichern'}
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
