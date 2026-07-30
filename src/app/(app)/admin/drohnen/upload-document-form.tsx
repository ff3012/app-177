'use client';

import { useActionState } from 'react';
import { uploadDroneDocument, type DroneDocumentFormState } from './actions';

const initialState: DroneDocumentFormState = {};

export function UploadDocumentForm() {
  const [state, formAction, pending] = useActionState(uploadDroneDocument, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Titel</label>
        <input
          name="title"
          required
          className="rounded border border-neutral-300 px-3 py-2"
          placeholder="z. B. Betriebshandbuch DJI Mavic 3"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">PDF-Datei</label>
        <input name="file" type="file" accept="application/pdf" required className="rounded border border-neutral-300 px-3 py-2" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Wird hochgeladen…' : 'Hochladen'}
      </button>
      {state.error && <p className="text-sm text-red-700 sm:basis-full">{state.error}</p>}
    </form>
  );
}
