'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReportWizard } from '@/app/(app)/meine-feuerwehr/berichte/neu/report-wizard';
import { ACTIVE_REPORT_TYPES, REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import type { ReportType } from '@prisma/client';
import { submitReportViaKiosk } from './actions';
import { WizardFrame } from './wizard-frame';

export interface KioskFlowProps {
  token: string;
  organizationName: string;
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentKindsByType: Record<string, string[]>;
}

type Phase =
  | { phase: 'name' }
  | { phase: 'type'; filledById: string }
  | { phase: 'wizard'; filledById: string; type: ReportType; run: number }
  | { phase: 'done'; number?: number; year?: number };

const REPORT_TYPES = ['ACTIVITY', 'EXERCISE', 'INCIDENT'] as const;
const DONE_RESET_MS = 30_000;

/**
 * Ablauf der iPad-Schnellerfassung als reiner Client-Zustand: Namenswahl -> Berichtsart -> Assistent ->
 * Bestätigung -> (nach 30 s oder "Neuer Bericht") zurück zur Namenswahl. Damit bleibt keine Person auf
 * dem gemeinsamen Gerät "angemeldet", und die Eingaben der Vorgängerin sind weg (der Assistent hält
 * seinen Zustand nur im Browser-Speicher und wird bei jedem Lauf neu eingehängt).
 */
export function KioskFlow({ token, organizationName, members, vehicles, recentKindsByType }: KioskFlowProps) {
  const [state, setState] = useState<Phase>({ phase: 'name' });
  const [run, setRun] = useState(0);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'mobile' | 'tablet'>('tablet');

  // Ab 1024 px das Tablet-Layout, darunter fällt der Assistent auf das Handy-Layout zurück.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const apply = () => setLayout(query.matches ? 'tablet' : 'mobile');
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const reset = useCallback(() => {
    setSearch('');
    setState({ phase: 'name' });
  }, []);

  // Nach der Bestätigung automatisch zurück zur Namenswahl; der Timer wird beim Verlassen der Phase gelöscht.
  const isDone = state.phase === 'done';
  useEffect(() => {
    if (!isDone) return;
    const timer = setTimeout(reset, DONE_RESET_MS);
    return () => clearTimeout(timer);
  }, [isDone, reset]);

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => `${member.lastName} ${member.firstName}`.toLowerCase().includes(needle));
  }, [members, search]);

  if (state.phase === 'wizard') {
    const filledBy = members.find((member) => member.id === state.filledById);
    const wizard = (
      <ReportWizard
        key={state.run}
        type={state.type}
        filledById={state.filledById}
        members={members}
        vehicles={vehicles}
        recentActivityKinds={recentKindsByType[state.type] ?? []}
        layout={layout}
        lockFilledBy
        tabletHeader={{
          title: `${REPORT_TYPE_LABEL[state.type]} · ${organizationName}`,
          subtitle: filledBy ? `Ausfüller: ${filledBy.firstName} ${filledBy.lastName}` : undefined,
        }}
        onSubmit={(payload) => submitReportViaKiosk(token, payload)}
        onDone={(result) => setState({ phase: 'done', number: result.number, year: result.year })}
        onCancel={reset}
      />
    );
    // Stabiler Rahmen in beiden Layouts: ein Layoutwechsel (Drehen) darf den Assistenten nicht neu einhängen.
    return <WizardFrame layout={layout}>{wizard}</WizardFrame>;
  }

  return (
    <div className="pt-safe flex min-h-[100dvh] touch-manipulation flex-col bg-[#f6f6f7] text-[#1c1c1e]">
      <header className="bg-[#1c1c1e] px-6 py-3 text-white">
        <span className="text-base font-semibold">{organizationName}</span>
        <span className="ml-3 text-sm opacity-80">Berichte erfassen</span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        {state.phase === 'name' && (
          <>
            <h1 className="mb-4 text-2xl font-bold">Wer schreibt den Bericht?</h1>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name suchen …"
              className="mb-5 min-h-[52px] w-full rounded-lg border border-neutral-300 bg-white px-4 text-base"
            />
            {filteredMembers.length === 0 ? (
              <p className="py-8 text-center text-base text-neutral-500">Keine Treffer.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 lg:grid-cols-4">
                {filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setState({ phase: 'type', filledById: member.id })}
                    className="min-h-[64px] rounded-xl border border-neutral-300 bg-white px-4 py-3 text-left text-[16px] font-semibold shadow-sm"
                  >
                    {member.lastName} {member.firstName}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {state.phase === 'type' && (
          <>
            <h1 className="mb-4 text-2xl font-bold">Welcher Bericht?</h1>
            <div className="grid grid-cols-3 gap-4">
              {REPORT_TYPES.map((type) => {
                const active = ACTIVE_REPORT_TYPES.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={!active}
                    onClick={() => {
                      // Jeder Lauf bekommt einen neuen key, damit der Assistent mit leerem Zustand startet.
                      const nextRun = run + 1;
                      setRun(nextRun);
                      setState({ phase: 'wizard', filledById: state.filledById, type, run: nextRun });
                    }}
                    className={`min-h-[96px] rounded-xl px-4 py-6 text-lg font-semibold shadow-sm ${
                      active ? 'bg-brand text-white' : 'bg-neutral-200 text-neutral-400'
                    }`}
                  >
                    {REPORT_TYPE_LABEL[type]}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={reset} className="mt-6 min-h-[52px] rounded-lg border border-neutral-300 bg-white px-6 text-[15px] font-semibold">
              ← Zurück
            </button>
          </>
        )}

        {state.phase === 'done' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <h1 className="text-3xl font-bold">Bericht abgegeben</h1>
            {state.number !== undefined && state.year !== undefined && (
              <p className="text-lg text-neutral-600">
                Nr. {state.number} / {state.year}
              </p>
            )}
            <button type="button" onClick={reset} className="mt-4 min-h-[56px] rounded-lg bg-brand px-10 text-[16px] font-semibold text-white">
              Neuer Bericht
            </button>
            <p className="text-sm text-neutral-400">Der Bildschirm wechselt nach 30 Sekunden von selbst zurück.</p>
          </div>
        )}
      </main>
    </div>
  );
}
