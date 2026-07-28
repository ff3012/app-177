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

/** Admin Drohnengruppe: eigenes Recht innerhalb der Drohnengruppe, unabhängig vom Abschnittskommando-Admin. */
export function isDroneGroupAdmin(user: SessionUser): boolean {
  return user.droneGroupRole === 'ADMIN';
}

/**
 * Sichtbarkeit des gesamten Drohnengruppe-Moduls: NUR "Mitglied Drohnengruppe" oder "Admin
 * Drohnengruppe" (isDrohnengruppeMember deckt beide Rollen ab, da es unabhängig von role gesetzt
 * wird). Bewusst KEINE Ausnahme mehr für Abschnittskommando-Mitglieder/-Admins ohne explizite
 * Drohnengruppen-Rolle — bewusste Sicherheitsentscheidung, siehe Security-Review der Drohnengruppe.
 */
export function canViewDroneModule(user: SessionUser): boolean {
  return user.isDrohnengruppeMember;
}

/** Darf einen neuen Flug registrieren (wird immer unter der eigenen registeredById angelegt). */
export function canRegisterFlight(user: SessionUser): boolean {
  return canViewDroneModule(user);
}

/**
 * Darf ALLE Flüge sehen (statt nur die selbst erfassten). Nur Admin Drohnengruppe — bewusst
 * kein pauschales Recht mehr für Abschnittskommando-Admins ohne diese Rolle.
 */
export function canViewAllFlights(user: SessionUser): boolean {
  return isDroneGroupAdmin(user);
}

/** Darf einen bestehenden Flug bearbeiten/löschen: Admin Drohnengruppe oder der Ersteller selbst. */
export function canManageFlight(user: SessionUser, flight: { registeredById: string }): boolean {
  return isDroneGroupAdmin(user) || flight.registeredById === user.id;
}

/**
 * News/Push-Modul: bewusst auf Abschnittskommando-Admin beschränkt (erste Version) statt
 * feuerwehrAdminOrgIds — eine Push-Nachricht geht direkt an Mobilgeräte, ohne die redaktionelle
 * Kontrolle, die z. B. ein Kalendertermin durch bloße Sichtbarkeit hat. Kann später auf
 * FF-Admins für ihre eigene Feuerwehr ausgeweitet werden, wenn das gewünscht ist.
 */
export function canManageNews(user: SessionUser): boolean {
  return isSiteAdmin(user);
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
