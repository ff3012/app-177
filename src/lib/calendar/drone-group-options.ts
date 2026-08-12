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
 * Lädt alle 4 Gruppen und filtert einzeln über canManageDroneGroupFor (bewusst nicht mehr nur die
 * eigene Mitgliedschaft - siehe canManageEvent in permissions.ts und Design-Spec Abschnitt 4.2).
 * Ergänzt am Ende den bezirksweiten Sentinel-Eintrag, wenn der Nutzer den bezirksweiten
 * Drohnengruppen-Termin anlegen darf (Bezirksadmin/Bezirks-Drohnenadmin).
 */
export async function getManageableDroneGroupOptions(user: SessionUser): Promise<DroneGroupFormOption[]> {
  const groups = await prisma.droneGroup.findMany({
    select: { id: true, name: true, organizationId: true },
    orderBy: { name: 'asc' },
  });
  const options: DroneGroupFormOption[] = groups
    .filter((group) => canManageDroneGroupFor(user, group))
    .map((group) => ({ id: group.id, name: group.name }));
  if (canManageBezirksWideDroneEvent(user)) {
    options.push({ id: BEZIRKSWEIT_DRONE_GROUP_VALUE, name: 'Alle Drohnengruppen (bezirksweit)' });
  }
  return options;
}
