'use client';

import { useActionState } from 'react';
import { createSondergruppe, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function AddSondergruppeForm() {
  const [state, formAction, pending] = useActionState(createSondergruppe, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="sondergruppe-name" className="text-sm font-medium text-neutral-700">
          Name
        </label>
        <input
          id="sondergruppe-name"
          name="name"
          required
          placeholder="Feuerwehrjugend"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {state.fieldErrors?.name && <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>}
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
