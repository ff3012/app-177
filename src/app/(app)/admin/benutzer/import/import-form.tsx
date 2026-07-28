'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { importUsers, type ImportUsersState } from './actions';
import { CopyLinkButton } from '@/components/ui/copy-link-button';

const initialState: ImportUsersState = {};

export function ImportUsersForm() {
  const [state, formAction, pending] = useActionState(importUsers, initialState);

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
            Erwartet die Spalten Vorname, Nachname, E-Mail, StbNr, Telefonnummer, Heimat-Feuerwehr — z. B. der{' '}
            <a href="/admin/benutzer/export" className="text-brand hover:underline">
              Excel-Export
            </a>{' '}
            als Vorlage. Bereits vorhandene Benutzer (gleiche StbNr + Heimat-Feuerwehr) werden übersprungen.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Willkommen-E-Mail senden</label>
          <select
            name="sendWelcomeEmail"
            defaultValue="ja"
            className="rounded border border-neutral-300 px-3 py-2"
          >
            <option value="ja">Ja – jeder neu angelegte Benutzer erhält eine Aktivierungs-E-Mail</option>
            <option value="nein">Nein – Aktivierungslinks werden stattdessen hier angezeigt</option>
          </select>
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
          <Link href="/admin/benutzer" className="text-sm text-neutral-600 hover:underline">
            Zur Benutzerliste
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

          {state.result.activationLinks.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="font-medium text-neutral-900">
                Aktivierungslinks zum manuellen Weitergeben (7 Tage gültig, einmalig verwendbar):
              </p>
              {state.result.activationLinks.map((entry) => (
                <div key={entry.email} className="flex items-start gap-2">
                  <div className="flex-1 rounded border border-neutral-200 bg-white px-3 py-2">
                    <p className="font-medium text-neutral-800">
                      {entry.name} <span className="font-normal text-neutral-500">({entry.email})</span>
                    </p>
                    <p className="break-all text-neutral-600">{entry.link}</p>
                  </div>
                  <CopyLinkButton text={entry.link} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
