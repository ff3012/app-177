import { prisma } from '@/lib/db/prisma';
import { canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import type { SessionUser } from '@/types/next-auth';

/**
 * Alle Drohnengruppen, die dieser Benutzer als Admin verwalten darf: Bezirksadmin/Bezirks-
 * Drohnenadmin sehen alle, ein Abschnittsadmin nur die am eigenen Abschnitt verankerte, ein
 * reiner Gruppen-Admin nur die eigene. Geteilt zwischen /admin/drohnen und dem Flugbuch
 * (/drohnen, /drohnen/export, /drohnen/90-tage-export) - vorher gab es hiervon zwei unabhängige
 * Kopien (eine inline in admin/drohnen/page.tsx), was bei einer künftigen Rechteänderung hätte
 * auseinanderlaufen können. Ein leeres Array bedeutet "kein Admin-Zugriff auf irgendeine Gruppe",
 * nicht zwingend "kein Drohnengruppen-Zugriff überhaupt" (ein reines Mitglied hat hier immer []).
 */
export async function getAllowedDroneGroups(user: SessionUser) {
  const allGroups = await prisma.droneGroup.findMany({ orderBy: { name: 'asc' } });
  return isBezirksAdmin(user) ? allGroups : allGroups.filter((g) => canManageDroneGroupFor(user, g));
}
