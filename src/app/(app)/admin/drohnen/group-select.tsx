'use client';

import { useRouter } from 'next/navigation';

interface DroneGroupOption {
  id: string;
  name: string;
}

/**
 * Analog zu OrgSelect (admin/heimatfeuerwehr/org-select.tsx), aber bewusst eine eigene, kleine
 * Komponente statt jene direkt zu importieren: OrgSelect navigiert hart auf
 * `/admin/heimatfeuerwehr?org=<id>` - für diese Seite wird stattdessen `/admin/drohnen?group=<id>`
 * gebraucht (anderer Pfad UND anderer Query-Param-Name). Nur gerendert, wenn mehr als eine
 * Drohnengruppe zur Auswahl steht (Bezirksadmin, oder ein Admin mehrerer Gruppen/Abschnitte).
 */
export function GroupSelect({ groups, selectedId }: { groups: DroneGroupOption[]; selectedId: string }) {
  const router = useRouter();

  return (
    <select
      value={selectedId}
      onChange={(event) => router.push(`/admin/drohnen?group=${event.target.value}`)}
      className="w-fit rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
    >
      {groups.map((group) => (
        <option key={group.id} value={group.id}>
          {group.name}
        </option>
      ))}
    </select>
  );
}
