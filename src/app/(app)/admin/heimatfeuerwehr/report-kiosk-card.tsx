'use client';

import { CopyLinkButton } from '@/components/ui/copy-link-button';

/**
 * Verwaltung der iPad-Berichte-Schnellerfassung einer Feuerwehr: Link anzeigen/kopieren, neu erzeugen,
 * abschalten. `createAction`/`disableAction` sind die bereits an die Organisation gebundenen Server
 * Actions (kein Client-seitiges Vertrauen: beide prüfen die Berechtigung erneut).
 */
export function ReportKioskCard({
  link,
  createAction,
  disableAction,
}: {
  link: string | null;
  createAction: () => Promise<void>;
  disableAction: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
      {link ? (
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 break-all rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">{link}</p>
            <CopyLinkButton text={link} />
          </div>
          <div className="flex flex-wrap gap-2">
            <form
              action={createAction}
              onSubmit={(event) => {
                if (!window.confirm('Neuen Link erzeugen? Der bisherige Link funktioniert danach nicht mehr, das iPad muss neu geöffnet werden.')) {
                  event.preventDefault();
                }
              }}
            >
              <button type="submit" className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken">
                Neuen Link erzeugen
              </button>
            </form>
            <form
              action={disableAction}
              onSubmit={(event) => {
                if (!window.confirm('Schnellerfassung abschalten? Der Link antwortet danach nicht mehr.')) event.preventDefault();
              }}
            >
              <button type="submit" className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-danger hover:bg-surface-sunken">
                Abschalten
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-muted">Noch nicht aktiv.</p>
          <form action={createAction}>
            <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover">
              Link erzeugen
            </button>
          </form>
        </>
      )}
    </div>
  );
}
