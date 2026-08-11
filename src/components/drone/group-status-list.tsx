export interface GroupStatusPilot {
  id: string;
  name: string;
  count: number;
  status: 'success' | 'warning' | 'danger';
}

const BAR_CLASS: Record<GroupStatusPilot['status'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const COUNT_TEXT_CLASS: Record<GroupStatusPilot['status'], string> = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger',
};

/**
 * Ersetzt GroupStatusChart (Säulendiagramm mit abgeschnittenen Namen bei mehr als ~6 Mitgliedern,
 * siehe dessen eigener Kommentar) durch eine waagrechte Balkenliste mit vollem Namen links -
 * skaliert unabhängig von der Mitgliederzahl, siehe Drohnengruppe-Brief.md §5/§9 ("bei 21 Piloten
 * bleibt die Liste lesbar"). `status` kommt bereits fertig klassifiziert von der aufrufenden Seite
 * (siehe Task 3) - diese Komponente trifft selbst keine Ampel-Entscheidung, nur Darstellung.
 */
export function GroupStatusList({
  pilots,
  groupName,
  required,
}: {
  pilots: GroupStatusPilot[];
  groupName: string;
  required: number;
}) {
  const metCount = pilots.filter((p) => p.status !== 'danger').length;

  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <span className="text-[15px] font-semibold text-ink">Gruppenstatus · 90-Tage-Regel · {groupName}</span>
        <span className="text-sm text-ink-muted">
          {metCount} von {pilots.length} erfüllt
        </span>
      </div>

      {pilots.length === 0 ? (
        <p className="text-sm text-ink-muted">Keine Mitglieder dieser Drohnengruppe hinterlegt.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {pilots.map((pilot) => (
            <div key={pilot.id} className="flex items-center gap-3">
              <span className="w-[132px] shrink-0 truncate text-sm font-medium text-ink">{pilot.name}</span>
              <span className="h-[22px] flex-1 overflow-hidden rounded bg-surface-sunken">
                <span
                  className={`block h-full ${BAR_CLASS[pilot.status]}`}
                  style={{ width: `${Math.min(100, Math.max(4, (pilot.count / required) * 100))}%` }}
                />
              </span>
              <span className={`w-[46px] shrink-0 text-right text-sm font-semibold ${COUNT_TEXT_CLASS[pilot.status]}`}>
                {pilot.count}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3.5 border-t border-line pt-3 text-xs text-ink-faint">
        Drei Flüge innerhalb von 90 Tagen sind erforderlich. Bernstein bedeutet: erfüllt, aber ein Flug fällt
        demnächst aus dem Fenster.
      </p>
    </div>
  );
}
