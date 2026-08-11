/** Einsatz nutzt jetzt dieselben danger-Tokens wie andere Status-Chips in dieser Codebase (z. B.
 * die Atemschutz-/Fahrzeug-Reservierungs-Badges) statt der vorherigen vollflächigen brand-Füllung -
 * Vollrot (brand) ist seit diesem Redesign dem Farbstreifen und der "Flug registrieren"-Aktion
 * vorbehalten, nicht mehr dem Chip selbst (Drohnengruppe-Brief.md §6). Übung nutzt surface-sunken
 * statt eines Outline-Rahmens, um optisch näher an den Kalender-Zweck-Chips zu liegen. */
export function PurposeBadge({ label }: { label: string }) {
  const isEinsatz = label === 'Einsatz';
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
        isEinsatz ? 'bg-danger-subtle text-danger' : 'bg-surface-sunken text-ink-muted'
      }`}
    >
      {label}
    </span>
  );
}
