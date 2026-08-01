'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { importVehicles, type ImportVehiclesState } from './actions';

const initialState: ImportVehiclesState = {};

export function ImportVehiclesForm({ organizationId }: { organizationId: string }) {
  const boundAction = importVehicles.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Excel-Datei (.xlsx)</label>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <p className="text-xs text-neutral-500">
            Erwartet die Spalten Taktische Bezeichnung, Kennzeichen, Marke, Typ — z. B. den{' '}
            <a href={`/admin/heimatfeuerwehr/fuhrpark-export?org=${organizationId}`} className="text-brand hover:underline">
              Excel-Export
            </a>{' '}
            als Vorlage. Bereits vorhandene Fahrzeuge (gleiches Kennzeichen) werden übersprungen.
          </p>
        </div>

        {state.error && <p className="text-sm text-red-700">{state.error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Wird importiert…' : 'Importieren'}
          </button>
          <Link href="/admin/heimatfeuerwehr" className="text-sm text-neutral-600 hover:underline">
            Zur Heimatfeuerwehr-Verwaltung
          </Link>
        </div>
      </form>

      {state.result && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <p className="font-medium text-neutral-900">
            {state.result.created} angelegt, {state.result.skipped} übersprungen (bereits vorhanden)
            {state.result.errors.length > 0 ? `, ${state.result.errors.length} mit Fehler` : ''}.
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {state.result.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
