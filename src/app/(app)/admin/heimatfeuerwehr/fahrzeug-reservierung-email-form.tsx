'use client';

import { useActionState, useEffect, useState } from 'react';
import { setFahrzeugReservierungEmail, type FahrzeugReservierungEmailState } from './actions';

const initialState: FahrzeugReservierungEmailState = {};

/** Freigabe-Adresse für neue Fahrzeug-Reservierungen (siehe lib/heimatfeuerwehr/notify-vehicle-booking.ts)
 * - leer lassen bedeutet: keine Freigabe nötig, Reservierungen werden sofort genehmigt. */
export function FahrzeugReservierungEmailForm({
  organizationId,
  initialEmail,
}: {
  organizationId: string;
  initialEmail: string;
}) {
  const boundAction = setFahrzeugReservierungEmail.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  return (
    <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="fahrzeugReservierungEmail" className="text-[13px] font-medium text-ink">
          E-Mail für Fahrzeug-Reservierungen
        </label>
        <input
          id="fahrzeugReservierungEmail"
          name="email"
          type="email"
          defaultValue={initialEmail}
          onChange={() => setDirty(true)}
          placeholder="z. B. kommando@ff-wolfsgraben.at"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <p className="text-xs text-ink-faint">
          Neue Reservierungen gehen an diese Adresse zur Freigabe (Genehmigen/Nicht genehmigen). Leer lassen: Reservierungen werden sofort genehmigt.
        </p>
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
