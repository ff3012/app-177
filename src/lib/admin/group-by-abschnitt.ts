/** Gruppiert eine Liste von Organisationen nach ihrem Abschnitt (abschnittName) - mit bis zu 124
 * Feuerwehren (Bezirksadmin) ist eine flache Liste sonst unbrauchbar. Orgs ohne abschnittName (z. B.
 * ein Feuerwehr-Admin mit 1-2 Optionen, oder ein Abschnitt selbst) landen unter "Ohne Abschnitt".
 * Gemeinsam genutzt von AdminOrgMultiSelect, OrgSearchSelect und UserManagementSection - vorher an
 * zwei Stellen fast identisch dupliziert. */
export function groupByAbschnitt<T extends { abschnittName?: string }>(organizations: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const org of organizations) {
    const key = org.abschnittName ?? 'Ohne Abschnitt';
    (groups[key] ??= []).push(org);
  }
  return groups;
}
