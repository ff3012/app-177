import { prisma } from '@/lib/db/prisma';
import { canManageBezirksWideDroneEvent, canManageDroneGroupFor } from '@/lib/auth/permissions';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
import type { SessionUser } from '@/types/next-auth';

export interface DroneGroupFormOption {
  id: string;
  name: string;
}

/**
 * Drohnengruppen, für die dieser Nutzer im Kalender-Formular einen Termin anlegen/bearbeiten darf.
 * Lädt nur aktive Gruppen (Bezirksverwaltung: isActive=false blendet eine Gruppe aus NEUEN
 * Zuordnungen aus) - AUSSER `currentDroneGroupId` ist gesetzt (Bearbeiten eines bestehenden
 * Drohnengruppen-Termins): dann bleibt genau diese eine Gruppe wählbar, auch wenn sie inzwischen
 * deaktiviert wurde, sonst könnte das Bearbeitungsformular den aktuellen Wert nicht mehr anzeigen.
 * Filtert einzeln über canManageDroneGroupFor (bewusst nicht nur die eigene Mitgliedschaft - siehe
 * canManageEvent in permissions.ts und Design-Spec Abschnitt 4.2 des Kalender/Drohnengruppen-Plans).
 * Ergänzt am Ende den bezirksweiten Sentinel-Eintrag, wenn der Nutzer den bezirksweiten
 * Drohnengruppen-Termin anlegen darf (Bezirksadmin/Bezirks-Drohnenadmin).
 */
export async function getManageableDroneGroupOptions(
  user: SessionUser,
  currentDroneGroupId?: string | null,
): Promise<DroneGroupFormOption[]> {
  const groups = await prisma.droneGroup.findMany({
    where: currentDroneGroupId ? { OR: [{ isActive: true }, { id: currentDroneGroupId }] } : { isActive: true },
    select: { id: true, name: true, organizationId: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const options: DroneGroupFormOption[] = groups
    .filter((group) => canManageDroneGroupFor(user, group))
    .map((group) => ({ id: group.id, name: group.isActive ? group.name : `${group.name} (deaktiviert)` }));
  if (canManageBezirksWideDroneEvent(user)) {
    options.push({ id: BEZIRKSWEIT_DRONE_GROUP_VALUE, name: 'Alle Drohnengruppen (bezirksweit)' });
  }
  return options;
}
