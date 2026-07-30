export interface PilotStatus {
  id: string;
  name: string;
  count: number;
  met: boolean;
}

/** Admin-Drohnengruppe-only (siehe drohnen/page.tsx) - zeigt anders als der frühere reine
 * 90-Tage-Bericht (nur als eigene Tabelle unter /drohnen/90-tage erreichbar) den Gruppenstatus
 * direkt auf der Hauptseite als Balkendiagramm. Bewusst nicht für alle Mitglieder sichtbar: würde
 * sonst erstmals den Compliance-Status anderer Piloten namentlich gegenüber Kollegen offenlegen,
 * was heute (auch beim bisherigen /90-tage-Bericht) nur Admin Drohnengruppe vorbehalten ist. */
export function GroupStatusChart({ pilots }: { pilots: PilotStatus[] }) {
  const maxCount = Math.max(1, ...pilots.map((p) => p.count));

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-white p-4 shadow-sm">
      <span className="font-semibold text-neutral-900">Gruppenstatus · {pilots.length} Mitglieder</span>
      {pilots.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine Mitglieder der Drohnengruppe hinterlegt.</p>
      ) : (
        <div className="flex items-end gap-3 overflow-x-auto pb-1">
          {pilots.map((pilot) => (
            <div key={pilot.id} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
              <div className="flex h-20 w-full items-end">
                <div
                  className={`w-full rounded-t ${pilot.met ? 'bg-green-600' : 'bg-red-600'}`}
                  style={{ height: `${Math.max(6, (pilot.count / maxCount) * 100)}%` }}
                />
              </div>
              <span className="w-full truncate text-center text-xs text-neutral-500" title={`${pilot.name} · ${pilot.count}`}>
                {pilot.name} {pilot.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
