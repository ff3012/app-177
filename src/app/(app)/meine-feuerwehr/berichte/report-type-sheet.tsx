'use client';

import { useRouter } from 'next/navigation';
import { REPORT_TYPE_LABEL, ACTIVE_REPORT_TYPES } from '@/lib/heimatfeuerwehr/report-constants';

const REPORT_TYPES = ['ACTIVITY', 'EXERCISE', 'INCIDENT'] as const;

/** "Welcher Bericht?" - öffnet bei "Neuer Bericht" vor dem eigentlichen Formular. Nicht aktive Typen
 * sind ausgegraut und nicht antippbar. Legt KEINEN Bericht in der DB an (kein Entwurf-Konzept mehr) -
 * navigiert nur zum Assistenten, der die Eingaben rein clientseitig hält, bis "Bericht abgeben"
 * gedrückt wird. */
export function ReportTypeSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  function choose(type: (typeof REPORT_TYPES)[number]) {
    if (!ACTIVE_REPORT_TYPES.includes(type)) return;
    router.push(`/meine-feuerwehr/berichte/neu?type=${type}`);
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
                disabled={!active}
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
      </div>
    </div>
  );
}
