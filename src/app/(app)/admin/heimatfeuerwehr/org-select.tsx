'use client';

import { useRouter } from 'next/navigation';

interface OrgOption {
  id: string;
  name: string;
  abschnittName?: string;
}

/** Nur gerendert, wenn mehr als eine Feuerwehr zur Auswahl steht (Site-Admin, Abschnittsadmin, oder ein
 * Admin mehrerer Feuerwehren) - navigiert per ?org=<id>, damit die Auswahl bookmarkbar/teilbar bleibt.
 * Gruppiert per <optgroup> nach Abschnitt, wenn abschnittName mitgegeben wird - mit bis zu 124
 * Feuerwehren (Bezirksadmin) ist eine flache Liste sonst unbrauchbar; für einen Feuerwehr-Admin mit nur
 * 1-2 Optionen bleibt abschnittName meist ungesetzt und die Liste sieht wie zuvor aus. */
export function OrgSelect({ organizations, selectedId }: { organizations: OrgOption[]; selectedId: string }) {
  const router = useRouter();

  const groups = new Map<string, OrgOption[]>();
  for (const org of organizations) {
    const key = org.abschnittName ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(org);
  }
  // Nur gruppieren, wenn wenigstens ein Eintrag tatsächlich einen abschnittName mitgibt - ein
  // Feuerwehr-Admin mit 1-2 Optionen und keinem abschnittName sieht weiterhin die schlichte flache Liste.
  const hasGroups = organizations.some((org) => Boolean(org.abschnittName));

  return (
    <select
      value={selectedId}
      onChange={(event) => router.push(`/admin/heimatfeuerwehr?org=${event.target.value}`)}
      className="w-fit rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
    >
      {hasGroups
        ? [...groups.entries()].map(([abschnittName, orgs]) => (
            <optgroup key={abschnittName} label={abschnittName || 'Ohne Abschnitt'}>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </optgroup>
          ))
        : organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
    </select>
  );
}
