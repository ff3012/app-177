'use client';

import { useState, useTransition } from 'react';
import { deletePhotoUpload } from '@/app/(app)/foto-uploads/actions';
import { isNextRedirectError } from '@/lib/auth/is-auth-error';

export function DeletePhotoUploadButton({ photoUploadId }: { photoUploadId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleDelete() {
    if (!window.confirm('Diesen Foto Upload wirklich löschen? Alle Fotos werden unwiderruflich entfernt.')) return;
    setError(undefined);
    startTransition(async () => {
      try {
        await deletePhotoUpload(photoUploadId);
      } catch (err) {
        if (isNextRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 disabled:opacity-60"
      >
        {pending ? 'Wird gelöscht…' : 'Foto Upload löschen'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
