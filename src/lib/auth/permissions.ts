import type { SessionUser } from '@/types/next-auth';

/** Site admin = Admin-Mitgliedschaft beim Abschnittsfeuerwehrkommando. */
export function isSiteAdmin(user: SessionUser): boolean {
  return user.isAbschnittsAdmin;
}

/**
 * Darf Termine für die angegebene Organisation (Feuerwehr oder Abschnittskommando) anlegen/bearbeiten.
 * Bewusst NUR auf expliziter Admin-Mitgliedschaft (feuerwehrAdminOrgIds), nicht pauschal auf isAbschnittsAdmin:
 * die Organisationsauswahl in den Formularen wird ebenfalls aus feuerwehrAdminOrgIds gebaut, ein pauschales
 * Abschnittskommando-Recht hier würde dort inkonsistent werden (Termin-Organisation fehlt in der Auswahl).
 */
export function canManageEventsFor(user: SessionUser, organizationId: string): boolean {
  return user.feuerwehrAdminOrgIds.includes(organizationId);
}

/** Darf einen Abschnitt-weiten (isSectionWide) Termin anlegen. */
export function canCreateSectionWideEvent(user: SessionUser): boolean {
  return user.isAbschnittsAdmin;
}

/** Sichtbarkeit des Drohnengruppe-Moduls: Drohnengruppe-Mitglieder + Abschnittskommando. */
export function canViewDroneModule(user: SessionUser): boolean {
  return user.isDrohnengruppeMember || user.isAbschnittskommandoMitglied;
}

/** Darf Flüge registrieren/bearbeiten (aktuell identisch zur Sichtbarkeit). */
export function canManageDroneFlights(user: SessionUser): boolean {
  return canViewDroneModule(user);
}

export class ForbiddenError extends Error {
  constructor(message = 'Keine Berechtigung für diese Aktion.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function assertPermission(condition: boolean, message?: string): void {
  if (!condition) {
    throw new ForbiddenError(message);
  }
}
