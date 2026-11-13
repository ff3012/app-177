import Link from 'next/link';
import { startChecklist } from '@/app/(app)/drohnen/checkliste/actions';
import { TOTAL_STEPS } from '@/lib/drone/checklist/labels';
import type { DraftListItem } from '@/lib/drone/checklist/queries';
import { DeleteDraftButton } from './delete-draft-button';
import { DiscardDraftButton } from './discard-draft-button';

function savedAt(date: Date): string {
  return date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
}

/** Karte "Checkliste Drohnenflug" auf /drohnen - nur sichtbar, wenn der Funktionsschalter der Gruppe an ist
 * (der Aufrufer prüft das). Zeigt alle Entwürfe der Gruppe, eigene zuerst. */
export function ChecklistCard({ droneGroupId, drafts, canStart }: { droneGroupId: string; drafts: DraftListItem[]; canStart: boolean }) {
  const startAction = startChecklist.bind(null, droneGroupId);
  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Vor dem Flug</span>
        <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Neu</span>
      </div>
      <h2 className="text-[17px] font-bold text-ink">Checkliste Drohnenflug</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Einsatzdaten, Kontrollen und Abschluss in neun Schritten. Der Stand wird laufend gespeichert und die Checkliste am Ende per E-Mail
        übermittelt.
      </p>
      {canStart && (
        <form action={startAction}>
          <button type="submit" className="min-h-11 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 sm:w-auto">
            Checkliste starten
          </button>
        </form>
      )}

      {drafts.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Entwürfe · {drafts.length}</div>
          <ul className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <li key={draft.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-ink">{draft.title}</span>
                    {draft.inFlight && (
                      <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Im Flug</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-ink-muted">
                    Schritt {draft.step + 1} von {TOTAL_STEPS} · gespeichert {savedAt(draft.updatedAt)}
                    {!draft.isOwn && ` · ${draft.creatorName}`}
                  </div>
                </div>
                <Link
                  href={`/drohnen/checkliste/${draft.id}?schritt=${draft.step}`}
                  className="flex min-h-11 items-center rounded-md bg-ink px-3 text-sm font-semibold text-white hover:opacity-90"
                >
                  {draft.inFlight ? 'Zum Flug' : 'Fortsetzen'}
                </Link>
                {draft.canManage && <DiscardDraftButton checklistId={draft.id} title={draft.title} />}
                {draft.canManage && <DeleteDraftButton checklistId={draft.id} title={draft.title} inFlight={draft.inFlight} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
