'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

export interface FlightFilterOptions {
  pilots: { id: string; name: string }[];
  drones: { id: string; name: string }[];
  totalCount: number;
  meineCount: number;
  fuerAndereErfasstCount: number;
  isAdmin: boolean;
}

const ZEITRAUM_LABEL: Record<string, string> = {
  '90tage': 'Letzte 90 Tage',
  jahr: 'Dieses Jahr',
  alle: 'Alle',
};

/**
 * Reine URL-Navigation, kein eigener Zustand: jede Änderung ersetzt den entsprechenden Query-
 * Parameter und lässt alle anderen (inkl. gruppe/take) unangetastet, damit "Filterzustand übersteht
 * Reload und ist als Link teilbar" (Brief-Abnahme) für jede einzelne Kombination gilt. `scope`
 * (ALLE/MEINE) wird sowohl vom "Meine"-Chip als auch vom "Alle Flüge einsehen"-Umschalter
 * geschrieben/gelesen - ein einziger Wahrheits-Zustand, zwei Bedienelemente (siehe Plan-Spec §3).
 */
export function FlightSidebar({ pilots, drones, totalCount, meineCount, fuerAndereErfasstCount, isAdmin }: FlightFilterOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const scope = searchParams.get('scope') === 'MEINE' ? 'MEINE' : 'ALLE';
  const zweck = searchParams.get('zweck') ?? '';
  const pilot = searchParams.get('pilot') ?? '';
  const drohne = searchParams.get('drohne') ?? '';
  const zeitraum = searchParams.get('zeitraum') ?? '90tage';

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('take');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-lg bg-surface p-4 shadow-card">
      <span className="text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Nur anzeigen</span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setParam('scope', '')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            scope === 'ALLE' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          Alle {totalCount}
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setParam('scope', 'MEINE')}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              scope === 'MEINE' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
            }`}
          >
            Meine {meineCount}
          </button>
        ) : (
          fuerAndereErfasstCount > 0 && (
            <span className="rounded-full bg-surface-sunken px-3 py-1.5 text-xs font-semibold text-ink-muted">
              Für andere erfasst {fuerAndereErfasstCount}
            </span>
          )
        )}
        <button
          type="button"
          onClick={() => setParam('zweck', zweck === 'EINSATZ' ? '' : 'EINSATZ')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            zweck === 'EINSATZ' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          Einsatz
        </button>
        <button
          type="button"
          onClick={() => setParam('zweck', zweck === 'UEBUNG' ? '' : 'UEBUNG')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            zweck === 'UEBUNG' ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          Übung
        </button>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
        {isAdmin && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">Pilot</span>
            <select
              value={pilot}
              onChange={(e) => setParam('pilot', e.target.value)}
              className="h-[38px] rounded-md border border-line bg-surface px-2.5 text-ink"
            >
              <option value="">Alle {pilots.length}</option>
              {pilots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">Drohne</span>
          <select
            value={drohne}
            onChange={(e) => setParam('drohne', e.target.value)}
            className="h-[38px] rounded-md border border-line bg-surface px-2.5 text-ink"
          >
            <option value="">Alle {drones.length}</option>
            {drones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">Zeitraum</span>
          <select
            value={zeitraum}
            onChange={(e) => setParam('zeitraum', e.target.value)}
            className="h-[38px] rounded-md border border-line bg-surface px-2.5 text-ink"
          >
            {Object.entries(ZEITRAUM_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Zweck</span>
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className="h-3.5 w-6 shrink-0 rounded bg-danger-subtle" /> Einsatz
        </span>
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className="h-3.5 w-6 shrink-0 rounded bg-surface-sunken" /> Übung
        </span>
      </div>

      {isAdmin && (
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
          <div>
            <div className="text-sm font-medium text-ink">Alle Flüge einsehen</div>
            <div className="text-xs text-ink-faint">Admin-Ansicht</div>
          </div>
          <ToggleSwitch label="" checked={scope === 'ALLE'} onChange={(checked) => setParam('scope', checked ? '' : 'MEINE')} />
        </div>
      )}
    </div>
  );
}
