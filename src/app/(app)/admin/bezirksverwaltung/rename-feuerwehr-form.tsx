'use client';

import { useActionState } from 'react';
import { renameFeuerwehr, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function RenameFeuerwehrForm({
  organizationId,
  currentName,
  currentShortName,
}: {
  organizationId: string;
  currentName: string;
  currentShortName: string;
}) {
  const boundRename = renameFeuerwehr.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundRename, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        defaultValue={currentName}
        required
        placeholder="Name"
        className="w-48 rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <input
        name="shortName"
        defaultValue={currentShortName}
        placeholder="Kurzname"
        className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? '…' : 'Speichern'}
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
      {state.fieldErrors?.name && <span className="text-xs text-red-700">{state.fieldErrors.name[0]}</span>}
    </form>
  );
}
