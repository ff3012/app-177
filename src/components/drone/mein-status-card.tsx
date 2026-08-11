interface MeinStatusCardProps {
  count: number;
  required: number;
  met: boolean;
  complianceUntilLabel: string | null;
  lastFlightAgoLabel: string | null;
}

/**
 * Ersetzt NinetyDayRing (SVG-Fortschrittsring) durch einen dreiteiligen Segment-Balken, wie im
 * Drohnengruppe-Brief.md §4.1 gefordert - dieselben Props wie NinetyDayRing, damit die Ablösung an
 * den Aufrufstellen ein reiner Import-Tausch ist. Die drei Segmente sind immer genau
 * NINETY_DAY_REQUIRED_FLIGHTS Stück (required), unabhängig von count - jedes Segment bis
 * einschließlich count ist grün gefüllt, der Rest grau (bg-surface-sunken), auch wenn count >
 * required (dann sind einfach alle Segmente grün, keine vierte Zelle für den Überschuss).
 */
export function MeinStatusCard({ count, required, met, complianceUntilLabel, lastFlightAgoLabel }: MeinStatusCardProps) {
  const segments = Array.from({ length: required }, (_, i) => i < count);

  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Mein Status</div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className={`font-condensed text-3xl font-bold ${met ? 'text-success-text' : 'text-danger'}`}>{count}</span>
        <span className="text-sm text-ink-muted">
          von {required} Flügen
          <br />
          in 90 Tagen
        </span>
      </div>
      <div className="mb-3 flex gap-1">
        {segments.map((filled, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${filled ? 'bg-success' : 'bg-surface-sunken'}`} />
        ))}
      </div>
      <div className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${met ? 'bg-success-subtle' : 'bg-danger-subtle'}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${met ? 'bg-success' : 'bg-danger'}`} />
        <span className={`text-sm font-medium ${met ? 'text-success-text' : 'text-danger'}`}>
          {met ? (complianceUntilLabel ? `Erfüllt · letzter Flug ${lastFlightAgoLabel ?? ''}` : 'Erfüllt') : 'Nicht erfüllt'}
        </span>
      </div>
    </div>
  );
}
