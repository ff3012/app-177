'use client';

import { useActionState } from 'react';
import { createFeuerwehr, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function AddFeuerwehrForm({ abschnitte }: { abschnitte: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createFeuerwehr, initialState);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-name" className="text-sm font-medium text-neutral-700">
          Name
        </label>
        <input id="feuerwehr-name" name="name" required placeholder="FF Neu" className="rounded border border-neutral-300 px-3 py-2" />
        {state.fieldErrors?.name && <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-shortName" className="text-sm font-medium text-neutral-700">
          Kurzname
        </label>
        <input id="feuerwehr-shortName" name="shortName" placeholder="Neu" className="rounded border border-neutral-300 px-3 py-2" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-nummer" className="text-sm font-medium text-neutral-700">
          Nummer
        </label>
        <input id="feuerwehr-nummer" name="nummer" required placeholder="17712" className="rounded border border-neutral-300 px-3 py-2" />
        {state.fieldErrors?.nummer && <p className="text-xs text-red-700">{state.fieldErrors.nummer[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="feuerwehr-parentId" className="text-sm font-medium text-neutral-700">
          Abschnitt
        </label>
        <select id="feuerwehr-parentId" name="parentId" required className="rounded border border-neutral-300 px-3 py-2">
          {abschnitte.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.parentId && <p className="text-xs text-red-700">{state.fieldErrors.parentId[0]}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : 'Anlegen'}
      </button>
      {state.error && <p className="col-span-full text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
