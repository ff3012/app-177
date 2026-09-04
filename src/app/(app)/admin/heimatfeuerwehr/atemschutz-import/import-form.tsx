'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { importAtemschutz, type ImportAtemschutzState } from './actions';

const initialState: ImportAtemschutzState = {};

export function ImportAtemschutzForm({ organizationId }: { organizationId: string }) {
  const boundAction = importAtemschutz.bind(null, organizationId);
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
            Erwartet den offiziellen Untersuchungs-Export mit den Spalten FW-Nr, StbNr, Untersuchtungsart,
            Untersuchtungsdatum, Tauglichkeitsart. Importiert wird nur für Mitglieder, die bereits als
            Atemschutzgeräteträger markiert sind.
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
            {state.result.imported} importiert, {state.result.skippedNotFound} übersprungen (nicht
            gefunden), {state.result.skippedNotTraeger} übersprungen (kein Atemschutzgeräteträger)
            {state.result.errors.length > 0 ? `, ${state.result.errors.length} mit Fehler` : ''}.
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {state.result.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
