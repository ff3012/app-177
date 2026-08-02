'use client';

import { useActionState, useEffect, useState } from 'react';
import { setFacebookConfig, type FacebookConfigState } from './dashboard-token-actions';

const initialState: FacebookConfigState = {};

interface DashboardFacebookConfigFormProps {
  organizationId: string;
  initialPageId: string;
  initialAccessToken: string;
}

/** Zwei Felder für die Facebook-Seite dieser Heimatfeuerwehr - analog zu AtemschutzSachbearbeiterForm
 * (leeres Feld ist gültig = "Facebook nicht verbunden" auf dem Dashboard). Das Access-Token-Feld ist
 * type="password", damit es beim Betrachten des Bildschirms (z. B. während einer Bildschirmfreigabe)
 * nicht im Klartext sichtbar ist. */
export function DashboardFacebookConfigForm({ organizationId, initialPageId, initialAccessToken }: DashboardFacebookConfigFormProps) {
  const boundAction = setFacebookConfig.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  return (
    <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="facebookPageId" className="text-[13px] font-medium text-ink">
          Facebook Page-ID
        </label>
        <input
          id="facebookPageId"
          name="facebookPageId"
          type="text"
          defaultValue={initialPageId}
          onChange={() => setDirty(true)}
          placeholder="z. B. feuerwehr.wolfsgraben"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="facebookPageAccessToken" className="text-[13px] font-medium text-ink">
          Page Access Token
        </label>
        <input
          id="facebookPageAccessToken"
          name="facebookPageAccessToken"
          type="password"
          defaultValue={initialAccessToken}
          onChange={() => setDirty(true)}
          placeholder="Long-Lived Page Access Token"
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
