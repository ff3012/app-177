'use client';

import { useState, useTransition } from 'react';
import { REPORT_TYPE_LABEL, ACTIVE_REPORT_TYPES } from '@/lib/heimatfeuerwehr/report-constants';
import { createReportDraft } from './actions';

const REPORT_TYPES = ['ACTIVITY', 'EXERCISE', 'INCIDENT'] as const;

/** Bericht-Brief.md §1b: "Welcher Bericht?" - öffnet bei jedem Einstieg (mit oder ohne Reservierung) vor
 * dem eigentlichen Formular. Nicht aktive Typen sind ausgegraut und nicht antippbar. */
export function ReportTypeSheet({ onClose }: { onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(type: (typeof REPORT_TYPES)[number]) {
    if (!ACTIVE_REPORT_TYPES.includes(type)) return;
    setError(null);
    // Kein try/catch: createReportDraft endet mit redirect(), das intern einen speziellen,
    // digest-getaggten Error wirft, der ungefangen bis zum Framework durchgereicht werden MUSS, um die
    // Navigation auszulösen (siehe user-form-sheet.tsx's createUser/updateUser-Aufruf für dasselbe
    // Muster in dieser Codebase). Ein try/catch hier würde diesen Error abfangen und die Navigation
    // verschlucken.
    startTransition(async () => {
      await createReportDraft(type);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 text-[17px] font-semibold text-[#1c1c1e]">Welcher Bericht?</h2>
        <div className="flex flex-col gap-2">
          {REPORT_TYPES.map((type) => {
            const active = ACTIVE_REPORT_TYPES.includes(type);
            return (
              <button
                key={type}
                type="button"
                disabled={!active || pending}
                onClick={() => choose(type)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3.5 text-left text-[15px] font-medium ${
                  active
                    ? 'border-brand text-[#1c1c1e]'
                    : 'cursor-not-allowed border-neutral-200 text-neutral-400'
                }`}
              >
                <span>{REPORT_TYPE_LABEL[type]}</span>
                {!active && <span className="text-xs font-normal">Bald verfügbar</span>}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
