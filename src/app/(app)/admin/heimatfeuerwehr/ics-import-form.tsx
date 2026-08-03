'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setIcsImportUrl, triggerIcsImportNow, type IcsImportUrlState } from './actions';

const initialState: IcsImportUrlState = {};

/** Periodischer Read-Only-Import externer Kalendertermine (z. B. ein Google Kalender) in den
 * Kalender dieser Feuerwehr - siehe lib/calendar/ics-import.ts. "Jetzt synchronisieren" ruft
 * dieselbe Sync-Funktion wie der 5-Minuten-Cron auf, für einen sofortigen Test statt auf den
 * nächsten Cron-Lauf zu warten. */
export function IcsImportForm({
  organizationId,
  initialUrl,
  initialLastSyncAt,
  initialLastSyncError,
}: {
  organizationId: string;
  initialUrl: string;
  initialLastSyncAt: string | null;
  initialLastSyncError: string | null;
}) {
  const boundAction = setIcsImportUrl.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [dirty, setDirty] = useState(false);
  const [syncPending, startSync] = useTransition();

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  function handleSyncNow() {
    startSync(async () => {
      const result = await triggerIcsImportNow(organizationId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Synchronisiert: ${result.imported} neu, ${result.updated} aktualisiert, ${result.removed} entfernt.`,
      );
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="icsImportUrl" className="text-[13px] font-medium text-ink">
            Externer Kalender (ICS-URL)
          </label>
          <input
            id="icsImportUrl"
            name="icsImportUrl"
            type="url"
            defaultValue={initialUrl}
            onChange={() => setDirty(true)}
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          />
          <p className="text-xs text-ink-faint">
            Termine aus diesem öffentlichen .ics-Feed werden alle 5 Minuten automatisch mit dem Kalender
            dieser Feuerwehr abgeglichen (angelegt/aktualisiert/entfernt). Importierte Termine können hier
            nicht manuell bearbeitet werden - Änderungen gehören in den Quellkalender.
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

      {initialUrl && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncPending}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunken disabled:opacity-60"
          >
            {syncPending ? 'Synchronisiere…' : 'Jetzt synchronisieren'}
          </button>
          <span className="text-xs text-ink-faint">
            {initialLastSyncError
              ? `Letzter Sync fehlgeschlagen: ${initialLastSyncError}`
              : initialLastSyncAt
                ? `Zuletzt synchronisiert: ${new Date(initialLastSyncAt).toLocaleString('de-AT')}`
                : 'Noch nicht synchronisiert.'}
          </span>
        </div>
      )}
    </div>
  );
}
