'use client';

import { useActionState } from 'react';
import { setTokenExpiry } from './dashboard-token-actions';

interface DashboardTokenExpiryFormProps {
  tokenId: string;
  organizationId: string;
  initialExpiresAt: string;
}

/** Ein Datum + "Setzen"-Button pro Token-Zeile, inline in der Tabelle - kein Dialog nötig, da nur ein
 * einziges Feld geändert wird. Leeres Datum = kein Ablauf (unbefristet). */
export function DashboardTokenExpiryForm({ tokenId, organizationId, initialExpiresAt }: DashboardTokenExpiryFormProps) {
  const boundAction = setTokenExpiry.bind(null, tokenId, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        type="date"
        name="expiresAt"
        defaultValue={initialExpiresAt}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line px-2 py-1 text-sm text-ink hover:bg-surface-sunken disabled:opacity-60"
      >
        Setzen
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
