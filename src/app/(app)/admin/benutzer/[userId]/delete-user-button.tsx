'use client';

import { useActionState, useState } from 'react';
import { deleteUser, type DeleteUserState } from '../actions';

const initialState: DeleteUserState = {};

export function DeleteUserButton({ userId }: { userId: string }) {
  const [confirming, setConfirming] = useState(false);
  const boundDelete = deleteUser.bind(null, userId);
  const [state, formAction, pending] = useActionState(boundDelete, initialState);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-sm text-red-700 hover:underline">
        Benutzer löschen
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-800">
        Diese Aktion kann nicht rückgängig gemacht werden. Der Benutzer wird endgültig gelöscht.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
        >
          {pending ? 'Wird gelöscht…' : 'BESTÄTIGEN LÖSCHEN'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm text-neutral-600 hover:underline"
        >
          Abbrechen
        </button>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
