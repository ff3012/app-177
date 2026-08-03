'use client';

import { useActionState, useTransition } from 'react';
import { toast } from 'sonner';
import { setOrganizationWappen, removeOrganizationWappen, type WappenUploadState } from './actions';
import { WappenFallbackIcon } from '@/components/layout/wappen-fallback-icon';

const initialState: WappenUploadState = {};

interface WappenUploadFormProps {
  organizationId: string;
  hasWappen: boolean;
  wappenSrc: string | null;
}

export function WappenUploadForm({ organizationId, hasWappen, wappenSrc }: WappenUploadFormProps) {
  const [state, formAction, pending] = useActionState(setOrganizationWappen.bind(null, organizationId), initialState);
  const [removing, startRemoving] = useTransition();

  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunken">
        {hasWappen && wappenSrc ? (
          <img src={wappenSrc} alt="Aktuelles Wappen" className="h-9 w-9 object-contain" />
        ) : (
          <WappenFallbackIcon size={26} />
        )}
      </div>
      <form action={formAction} className="flex flex-1 flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-sm font-medium text-ink">Wappen-Bild</label>
          <input
            name="file"
            type="file"
            accept="image/*"
            required
            className="rounded border border-line px-3 py-2 text-sm text-ink"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Wird hochgeladen…' : 'Hochladen'}
        </button>
      </form>
      {hasWappen && (
        <button
          type="button"
          disabled={removing}
          onClick={() =>
            startRemoving(async () => {
              await removeOrganizationWappen(organizationId);
              toast.success('Wappen entfernt.');
            })
          }
          className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-60"
        >
          Entfernen
        </button>
      )}
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </div>
  );
}
