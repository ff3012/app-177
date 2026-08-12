'use client';

import { useRouter } from 'next/navigation';
import { OrgSearchSelect } from '@/components/admin/org-search-select';

interface OrgOption {
  id: string;
  name: string;
  abschnittName?: string;
}

/** Nur gerendert, wenn mehr als eine Feuerwehr zur Auswahl steht (Site-Admin, Abschnittsadmin, oder ein
 * Admin mehrerer Feuerwehren) - navigiert per ?org=<id>, damit die Auswahl bookmarkbar/teilbar bleibt.
 * Durchsuchbar über OrgSearchSelect (dieselbe Komponente, die GitHub issue #13 bereits für das
 * Heimat-Feuerwehr-Feld in UserFormSheet einführte) statt eines flachen <select> - mit bis zu 124
 * Feuerwehren (Bezirksadmin) hat eine ungefilterte Liste keine brauchbare Tipp-Navigation.
 * OrgSearchSelect übernimmt die Abschnitt-Gruppierung (groupByAbschnitt) bereits intern, daher entfällt
 * die frühere eigene <optgroup>-Logik hier vollständig. Kein allLabel - wie beim Heimat-Feuerwehr-Feld
 * gibt es hier immer genau eine echte Auswahl, kein "Alle"-Konzept. */
export function OrgSelect({ organizations, selectedId }: { organizations: OrgOption[]; selectedId: string }) {
  const router = useRouter();

  return (
    <OrgSearchSelect
      options={organizations}
      value={selectedId}
      onChange={(id) => router.push(`/admin/heimatfeuerwehr?org=${id}`)}
      placeholder="Feuerwehr"
      triggerClassName="w-fit"
    />
  );
}
