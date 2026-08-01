'use client';

import { useRouter } from 'next/navigation';

interface OrgOption {
  id: string;
  name: string;
}

/** Nur gerendert, wenn mehr als eine Feuerwehr zur Auswahl steht (Site-Admin, oder ein Admin
 * mehrerer Feuerwehren) - navigiert per ?org=<id>, damit die Auswahl bookmarkbar/teilbar bleibt. */
export function OrgSelect({ organizations, selectedId }: { organizations: OrgOption[]; selectedId: string }) {
  const router = useRouter();

  return (
    <select
      value={selectedId}
      onChange={(event) => router.push(`/admin/heimatfeuerwehr?org=${event.target.value}`)}
      className="w-fit rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
    >
      {organizations.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
