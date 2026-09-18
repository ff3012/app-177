'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { importAusbildung, type ImportAusbildungState } from './actions';

const initialState: ImportAusbildungState = {};

export function ImportAusbildungForm() {
  const [state, formAction, pending] = useActionState(importAusbildung, initialState);

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
            Erwartet den FDISK-Ausbildungs-Export mit den Spalten FW-Nr, StbNr, email, A1/A3 Datum, A2
            Datum, BOS1 Datum, BOS2 Datum. Aktualisiert nur Mitglieder, die bereits einer Drohnengruppe
            angehören, und überschreibt nie bereits gesetzte Ausbildungsdaten.
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
          <Link href="/admin/drohnen" className="text-sm text-neutral-600 hover:underline">
            Zur Drohnengruppen-Verwaltung
          </Link>
        </div>
      </form>

      {state.result && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <p className="font-medium text-neutral-900">
            {state.result.updatedFields} Felder aktualisiert, {state.result.skippedAlreadySet} übersprungen
            (bereits vorhanden), {state.result.skippedNotMember} Zeilen übersprungen (kein
            Drohnengruppen-Mitglied)
            {state.result.skippedMissingPrereq.length > 0
              ? `, ${state.result.skippedMissingPrereq.length} Felder übersprungen (Vorstufe fehlt)`
              : ''}
            {state.result.errors.length > 0 ? `, ${state.result.errors.length} mit Fehler` : ''}.
          </p>
          {state.result.skippedMissingPrereq.length > 0 && (
            <>
              <p className="mt-2 font-medium text-amber-700">Übersprungen (Vorstufe fehlt):</p>
              <ul className="list-disc pl-5 text-amber-700">
                {state.result.skippedMissingPrereq.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
          {state.result.emailMismatches.length > 0 && (
            <>
              <p className="mt-2 font-medium text-neutral-700">Hinweise (abweichende E-Mail):</p>
              <ul className="list-disc pl-5 text-neutral-700">
                {state.result.emailMismatches.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
          {state.result.errors.length > 0 && (
            <>
              <p className="mt-2 font-medium text-red-700">Fehler:</p>
              <ul className="list-disc pl-5 text-red-700">
                {state.result.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
