import type { SessionUser } from '@/types/next-auth';

export function isBezirksAdmin(user: SessionUser): boolean {
  return user.isBezirksAdmin;
}

/** Admin des angegebenen Abschnitts (Organization.id vom Typ ABSCHNITTSKOMMANDO), oder Bezirksadmin. */
export function canManageAbschnittFor(user: SessionUser, abschnittOrganizationId: string): boolean {
  return isBezirksAdmin(user) || user.abschnittAdminOrgIds.includes(abschnittOrganizationId);
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
  return user.abschnittAdminOrgIds.length > 0;
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
 * Verwaltung einer Drohnengruppe (QR-Token/Unterlagen/Drohnen/Mitgliederliste dieser Gruppe):
 * Bezirksadmin, Admin des Abschnitts, an dem die Gruppe verankert ist, oder Admin Drohnengruppe der
 * eigenen Gruppe. Eigene Funktion statt canManageHeimatfeuerwehrFor wiederzuverwenden, da DroneGroup
 * keine Organization ist.
 */
export function canManageDroneGroupFor(
  user: SessionUser,
  droneGroup: { id: string; organizationId: string },
): boolean {
  return (
    isBezirksAdmin(user) ||
    canManageAbschnittFor(user, droneGroup.organizationId) ||
    (user.droneGroupRole === 'ADMIN' && user.droneGroupId === droneGroup.id)
  );
}

/**
 * News/Push-Modul: bewusst auf Abschnittskommando-Admin beschränkt (erste Version) statt
 * feuerwehrAdminOrgIds — eine Push-Nachricht geht direkt an Mobilgeräte, ohne die redaktionelle
 * Kontrolle, die z. B. ein Kalendertermin durch bloße Sichtbarkeit hat. Kann später auf
 * FF-Admins für ihre eigene Feuerwehr ausgeweitet werden, wenn das gewünscht ist.
 */
export function canManageNews(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}

/**
 * Sichtbarkeit eines einzelnen Termins - identische Regel wie die Kalenderübersicht-Query selbst
 * (eigene Feuerwehr ODER abschnittsweit INNERHALB DES EIGENEN ABSCHNITTS; Drohnengruppe-Kategorie
 * zusätzlich nur mit Modulzugriff). `eventAbschnittOrganizationId` muss der Aufrufer selbst via
 * getAbschnittOrganizationId(event.organization) berechnen - diese Funktion hat keinen DB-Zugriff.
 * Muss bei einer Änderung der Sichtbarkeitsregel in kalender/page.tsx mitgezogen werden.
 */
export function canViewEvent(
  user: SessionUser,
  event: {
    organizationId: string;
    isSectionWide: boolean;
    category: string;
    eventAbschnittOrganizationId: string;
    droneGroupId: string | null;
  },
): boolean {
  const visible =
    event.organizationId === user.homeOrganizationId ||
    (event.isSectionWide && event.eventAbschnittOrganizationId === user.homeAbschnittOrganizationId);
  if (!visible) return false;
  if (event.category === 'DROHNENGRUPPE') {
    return canViewDroneModule(user) && event.droneGroupId === user.droneGroupId;
  }
  return true;
}

/**
 * Admin Heimatfeuerwehr für organizationId (= canManageEventsFor) ODER Abschnittskommando-Admin -
 * bewusst eine eigene, benannte Funktion statt canManageEventsFor direkt wiederzuverwenden: die
 * Regel unterscheidet sich (Site-Admin hat hier IMMER Zugriff auf jede Feuerwehr, bei
 * Terminen bewusst nicht, siehe Kommentar über canManageEventsFor).
 */
export function canManageHeimatfeuerwehrFor(user: SessionUser, organizationId: string): boolean {
  return isBezirksAdmin(user) || canManageEventsFor(user, organizationId);
}

/** Sichtbarkeit des Verwaltungsmenüs "Heimatfeuerwehr" - Site-Admin ODER Admin von mindestens
 * einer Feuerwehr (auch ohne Abschnittskommando-Admin zu sein). */
export function canAccessHeimatfeuerwehrAdmin(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.feuerwehrAdminOrgIds.length > 0 || user.abschnittAdminOrgIds.length > 0;
}

/**
 * Benutzerverwaltung (Ansicht/Bearbeiten/Anlegen) für organizationId - identische Regel wie
 * canManageHeimatfeuerwehrFor (Site-Admin ODER Admin dieser Feuerwehr). Eigene, benannte Funktion
 * statt canManageHeimatfeuerwehrFor direkt an den Benutzerverwaltungs-Aufrufstellen
 * wiederzuverwenden - nur für Lesbarkeit dort, die Regel könnte künftig divergieren. Ein
 * Feuerwehr-Admin darf damit nur Benutzer DIESER Feuerwehr sehen/bearbeiten und neue Benutzer nur
 * MIT dieser Feuerwehr als Heimat-Feuerwehr anlegen; nur ein Abschnittskommando-Admin
 * (isSiteAdmin) darf Benutzer jeder Feuerwehr verwalten.
 */
export function canManageUsersFor(user: SessionUser, organizationId: string): boolean {
  return canManageHeimatfeuerwehrFor(user, organizationId);
}

/** Sichtbarkeit des Verwaltungsmenüs "Benutzer" - Site-Admin ODER Admin von mindestens einer
 * Feuerwehr (analog canAccessHeimatfeuerwehrAdmin). */
export function canAccessUserManagementAdmin(user: SessionUser): boolean {
  return canAccessHeimatfeuerwehrAdmin(user);
}

/** Fahrzeug-Buchung stornieren/verwalten: die eigene Buchung, oder Admin der Feuerwehr, der das
 * gebuchte Fahrzeug gehört. */
export function canManageVehicleBooking(
  user: SessionUser,
  booking: { userId: string },
  vehicleOrganizationId: string,
): boolean {
  return booking.userId === user.id || canManageHeimatfeuerwehrFor(user, vehicleOrganizationId);
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
