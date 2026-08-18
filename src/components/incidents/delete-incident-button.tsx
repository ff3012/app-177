'use client';

import { useState, useTransition } from 'react';
import { deleteIncident } from '@/app/(app)/meine-feuerwehr/einsaetze/actions';
import { isNextRedirectError } from '@/lib/auth/is-auth-error';

/** Findet I4 (Final-Review): deleteIncident (actions.ts) hatte keine Aufrufstelle im gesamten `src/` -
 * der Server Action war unerreichbar. Folgt demselben window.confirm-vor-Aufruf-Muster wie
 * IncidentPhotoGallery's eigener Foto-Lösch-Button. deleteIncident redirected bei Erfolg selbst
 * (nach /meine-feuerwehr/einsaetze) - dieser Redirect ist technisch ein geworfener NEXT_REDIRECT-
 * Kontrollfluss-Fehler (siehe is-auth-error.ts), der hier NICHT als echter Fehler abgefangen werden
 * darf, sonst würde der Redirect nie stattfinden. */
export function DeleteIncidentButton({ incidentId }: { incidentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleDelete() {
    if (!confirm('Diesen Einsatz wirklich löschen? Alle zugehörigen Fotos werden dabei unwiderruflich entfernt.')) {
      return;
    }
    setError(undefined);
    startTransition(async () => {
      try {
        await deleteIncident(incidentId);
      } catch (err) {
        if (isNextRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : 'Einsatz konnte nicht gelöscht werden.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="min-h-11 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 disabled:opacity-60"
      >
        {pending ? 'Wird gelöscht…' : 'Einsatz löschen'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
