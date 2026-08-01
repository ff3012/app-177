'use client';

import { useActionState, useEffect, useState } from 'react';
import { setAtemschutzSachbearbeiter, type AtemschutzSachbearbeiterState } from './actions';

const initialState: AtemschutzSachbearbeiterState = {};

/** Kontaktadresse für die tägliche Atemschutz-Fristen-Warn-E-Mail (siehe
 * lib/heimatfeuerwehr/notify-atemschutz-warnung.ts) - bewusst optional (leer lassen = keine
 * Warn-Mail für diese Feuerwehr), anders als die verpflichtenden E-Mail-Felder auf /admin/email. */
export function AtemschutzSachbearbeiterForm({
  organizationId,
  initialEmail,
}: {
  organizationId: string;
  initialEmail: string;
}) {
  const boundAction = setAtemschutzSachbearbeiter.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  return (
    <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="sachbearbeiterEmail" className="text-[13px] font-medium text-ink">
          Sachbearbeiter Atemschutz (E-Mail)
        </label>
        <input
          id="sachbearbeiterEmail"
          name="email"
          type="email"
          defaultValue={initialEmail}
          onChange={() => setDirty(true)}
          placeholder="z. B. atemschutz@ff-purkersdorf.at"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
          saved ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
        }`}
      >
        {pending ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
      </button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
