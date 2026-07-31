import { LAYER_COLORS, LAYER_LABELS } from '@/lib/calendar/layer-colors';

/** Explains the 3 event colors used both in the month grid (calendar-view.tsx) and the mobile
 * card accent bar (event-list-view.tsx) - reads from the same layer-colors.ts as both, so the
 * swatches shown here can never drift from what's actually painted elsewhere. */
export function LayerLegend({ showDrone }: { showDrone: boolean }) {
  const keys = showDrone ? (['own', 'abschnitt', 'drohnengruppe'] as const) : (['own', 'abschnitt'] as const);

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Legende</span>
      {keys.map((key) => (
        <div key={key} className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ backgroundColor: LAYER_COLORS[key] }} />
          {LAYER_LABELS[key]}
        </div>
      ))}
    </div>
  );
}
