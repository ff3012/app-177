import type { SessionUser } from '@/types/next-auth';
import { canViewChecklist, type ChecklistStatus } from '@/lib/auth/permissions';

/** So viele Checklisten bietet "Flug registrieren" zur Übernahme an. */
export const FLIGHT_CHECKLIST_LIMIT = 4;

export interface SelectableChecklist {
  id: string;
  status: ChecklistStatus;
  createdById: string;
  submittedById?: string | null;
  updatedAt: Date;
}

/** Die letzten Checklisten (Entwurf oder abgeschlossen, nie verworfen), die der Benutzer sehen darf -
 * neueste Änderung zuerst. Dieselbe Sichtbarkeitsregel wie überall (canViewChecklist), damit hier nie
 * eine Checkliste auftaucht, die der Benutzer sonst nicht öffnen dürfte. */
export function selectChecklistsForFlight<T extends SelectableChecklist>(
  checklists: T[],
  user: SessionUser,
  droneGroup: { id: string; organizationId: string },
): T[] {
  return checklists
    .filter((c) => c.status !== 'DISCARDED' && canViewChecklist(user, c, droneGroup))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, FLIGHT_CHECKLIST_LIMIT);
}
