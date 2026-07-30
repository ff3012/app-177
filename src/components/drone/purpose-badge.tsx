/** "Einsatz" is the more attention-worthy purpose (real operational flight, vs. routine "Übung"),
 * so it gets the solid brand-red fill while "Übung" stays a plain outlined pill. */
export function PurposeBadge({ label }: { label: string }) {
  const isEinsatz = label === 'Einsatz';
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isEinsatz ? 'bg-brand text-white' : 'border border-neutral-300 text-neutral-600'
      }`}
    >
      {label}
    </span>
  );
}
