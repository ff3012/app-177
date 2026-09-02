'use client';

import { useActionState } from 'react';
import { renameSondergruppe, type BezirksverwaltungFormState } from './actions';

const initialState: BezirksverwaltungFormState = {};

export function RenameSondergruppeForm({
  sondergruppeId,
  currentName,
}: {
  sondergruppeId: string;
  currentName: string;
}) {
  const boundRename = renameSondergruppe.bind(null, sondergruppeId);
  const [state, formAction, pending] = useActionState(boundRename, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input name="name" defaultValue={currentName} required className="rounded border border-neutral-300 px-2 py-1 text-sm" />
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
