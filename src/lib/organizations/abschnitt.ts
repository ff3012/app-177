/**
 * Löst den Abschnitt (Organization.id vom Typ ABSCHNITTSKOMMANDO) einer Organisation auf: bei einem
 * Abschnitt selbst ist das die Organisation selbst, bei einer Feuerwehr ihr parentId. Genutzt sowohl
 * für SessionUser.homeAbschnittOrganizationId (build-session-user.ts) als auch zur Auflösung des
 * Abschnitts eines Termin-Erstellers (siehe canViewEvent/kalender-Queries) - eine einzige Stelle statt
 * derselben Fallunterscheidung zweimal.
 */
export function getAbschnittOrganizationId(org: {
  type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  id: string;
  parentId: string | null;
}): string {
  return org.type === 'ABSCHNITTSKOMMANDO' ? org.id : org.parentId!;
}
