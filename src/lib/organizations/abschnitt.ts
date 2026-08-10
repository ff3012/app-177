/**
 * Organization.nummer des Abschnitts, für den der historische, gemeinsame ABSCHNITTS_ICS_TOKEN-Feed
 * (kalender/ics/[token]/route.ts, ein einziges Umgebungs-Secret ohne Bezug zu einer Organization-Zeile)
 * gebaut wurde. Seit der Bezirks-Hierarchie gibt es 7 Abschnitte, dieser eine Feed aber weiterhin nur
 * ein einziges Token - er bleibt deshalb bewusst auf diesen Abschnitt festgenagelt (Query UND Titel),
 * und kalender/page.tsx bietet den Abo-Link nur noch Nutzern dieses Abschnitts an, statt allen 124
 * Feuerwehren einen mit "Purkersdorf" beschrifteten Feed anzubieten.
 */
export const LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER = '17700';

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
  if (org.type === 'ABSCHNITTSKOMMANDO') return org.id;
  // Bewusst ein lauter Fehler statt eines stillen `parentId!`: ein null durchgereichter Abschnitt
  // landete sonst tief in einer Prisma-Query und produzierte dort eine kryptische
  // "Argument `id` is missing"-Validierungsfehlermeldung, ohne die eigentliche Ursache (fehlendes
  // parentId-Backfill, siehe 20260809010000_hierarchie_backfill) zu nennen.
  if (!org.parentId) {
    throw new Error(`Feuerwehr-Organisation ${org.id} hat keinen parentId - Datenmigration fehlt.`);
  }
  return org.parentId;
}
