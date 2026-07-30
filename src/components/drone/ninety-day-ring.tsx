interface NinetyDayRingProps {
  count: number;
  required: number;
  met: boolean;
  complianceUntilLabel: string | null;
  lastFlightAgoLabel: string | null;
}

/** Ersetzt die frühere reine Text-Pille (nur per title-Tooltip erklärt, auf Mobile also gar nicht
 * entdeckbar) durch eine echte Statuskarte mit sichtbarem Fortschrittsring - SVG-Ring per
 * stroke-dasharray/-dashoffset statt CSS conic-gradient, da das ohne zusätzliche Bibliothek in
 * jedem Browser gleich aussieht. */
export function NinetyDayRing({ count, required, met, complianceUntilLabel, lastFlightAgoLabel }: NinetyDayRingProps) {
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(count / required, 1);
  const dashOffset = circumference * (1 - progress);
  const color = met ? '#22a06b' : '#e4322b';

  return (
    <div className="flex items-center gap-5 rounded-lg bg-white p-4 shadow-sm">
      <div className="relative h-[88px] w-[88px] shrink-0">
        <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
          <circle cx="44" cy="44" r={radius} fill="none" stroke="#eeeef0" strokeWidth="8" />
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-neutral-900">
            {count}/{required}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">Flüge</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-neutral-900">90-Tage-Regel</span>
        <span className={`text-sm font-medium ${met ? 'text-green-700' : 'text-red-700'}`}>
          {met ? (complianceUntilLabel ? `Erfüllt bis ${complianceUntilLabel}` : 'Erfüllt') : 'Nicht erfüllt'}
        </span>
        {lastFlightAgoLabel && <span className="text-xs text-neutral-400">{lastFlightAgoLabel}</span>}
      </div>
    </div>
  );
}
