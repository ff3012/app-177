import type { SessionUser } from '@/types/next-auth';
import type { NewsAudience } from '@prisma/client';

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

/**
 * Darf einen Abschnitt-weiten (isSectionWide) Termin FÜR DIESEN Abschnitt anlegen/bearbeiten/löschen.
 * Der Abschnitt ist der des Termin-Eigentümers, aufzulösen über getAbschnittOrganizationId(organization).
 * Bewusst nicht mehr die pauschale Frage "verwaltet dieser Nutzer IRGENDEINEN Abschnitt": wer Admin von
 * Abschnitt A ist und zusätzlich eine direkte Feuerwehr-Admin-Mitgliedschaft unter Abschnitt B hat,
 * konnte damit einen im gesamten Abschnitt B sichtbaren (und pushbaren) Termin anlegen.
 */
export function canCreateSectionWideEvent(user: SessionUser, abschnittOrganizationId: string): boolean {
  return canManageAbschnittFor(user, abschnittOrganizationId);
}

/**
 * Reine UI-Vorabprüfung für die Termin-Formularseiten ("überhaupt ein Abschnitt-Recht?"), damit die
 * Checkbox/Kategorie-Auswahl gar nicht erst gerendert wird. Die eigentliche, abschnittsgenaue
 * Absicherung ist canCreateSectionWideEvent in den Server Actions - nicht diese Funktion.
 */
export function canCreateAnySectionWideEvent(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.abschnittAdminOrgIds.length > 0;
}

/**
 * Darf einen Bezirk-weiten (isDistrictWide) ALLGEMEIN-Termin anlegen/bearbeiten/löschen - Bezirksadmin
 * oder JEDER Abschnittsadmin (nicht nur für den eigenen Abschnitt - explizite Nutzerentscheidung, siehe
 * Design-Spec Abschnitt "Termin-Formular & Berechtigungen"). Bewusst eine eigene Funktion mit
 * identischem Körper zu canCreateAnySectionWideEvent statt deren Wiederverwendung: jene Funktion ist
 * eine reine UI-Vorabprüfung für die Abschnitt-weite Checkbox, diese hier ist die tatsächliche
 * serverseitige Durchsetzung für eine andere, unabhängige Geltungsbereichs-Stufe - beide dürfen sich
 * unabhängig voneinander weiterentwickeln, ohne sich gegenseitig zu beeinflussen. Sowohl UI-Vorprüfung
 * als auch serverseitige Durchsetzung, da es (anders als bei Abschnitt-weit) keinen sinnvollen
 * Zwischenschritt ("für WELCHEN Bezirk") gibt - es gibt nur einen Bezirk.
 */
export function canCreateBezirksWideEvent(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.abschnittAdminOrgIds.length > 0;
}

/** Admin Drohnengruppe: eigenes Recht innerhalb der Drohnengruppe, unabhängig vom Abschnittskommando-Admin. */
export function isDroneGroupAdmin(user: SessionUser): boolean {
  return user.droneGroupRole === 'ADMIN';
}

/**
 * Sichtbarkeit des gesamten Drohnengruppe-Moduls: "Mitglied Drohnengruppe"/"Admin Drohnengruppe"
 * (isDrohnengruppeMember deckt beide Rollen ab, da es unabhängig von role gesetzt wird) ODER
 * Bezirks-Drohnenadmin. Bewusst KEINE Ausnahme für Bezirksadmin oder Abschnittsadmin ohne eigene
 * Drohnengruppen-Rolle — bewusste Sicherheitsentscheidung, siehe Security-Review der Drohnengruppe.
 * isBezirksDrohnenAdmin ist davon unbenommen: anders als der generische Bezirks-/Abschnittsadmin ist
 * das eine eigens für die Drohnengruppen-Verwaltung vergebene Rolle (siehe canManageDroneGroupFor),
 * die ohne diese Ausnahme selbst nie über die erste Zeile dieser Funktion hinauskäme, wenn ihr
 * Inhaber (noch) kein persönliches DrohnengruppeMembership hat.
 */
export function canViewDroneModule(user: SessionUser): boolean {
  return user.isDrohnengruppeMember || user.isBezirksDrohnenAdmin;
}

/** Darf einen neuen Flug registrieren (wird immer unter der eigenen registeredById angelegt). */
export function canRegisterFlight(user: SessionUser): boolean {
  return canViewDroneModule(user);
}

/**
 * Darf für eine KONKRETE Drohnengruppe einen Flug registrieren: eigenes Mitglied dieser Gruppe
 * (jede Rolle) oder wer sie verwalten darf (canManageDroneGroupFor) - Letzteres, damit ein
 * Bezirksadmin/Bezirks-Drohnenadmin/Abschnittsadmin auch ohne eigene Mitgliedschaft in fremden
 * Gruppen Flüge erfassen kann, z. B. um einen telefonisch gemeldeten Flug nachzutragen.
 */
export function canRegisterFlightFor(user: SessionUser, droneGroup: { id: string; organizationId: string }): boolean {
  return user.droneGroupId === droneGroup.id || canManageDroneGroupFor(user, droneGroup);
}

/**
 * Darf ALLE Flüge sehen (statt nur die selbst erfassten). Nur Admin Drohnengruppe — bewusst
 * kein pauschales Recht mehr für Abschnittskommando-Admins ohne diese Rolle.
 */
export function canViewAllFlights(user: SessionUser): boolean {
  return isDroneGroupAdmin(user);
}

/**
 * Darf einen bestehenden Flug bearbeiten/löschen: wer die Drohnengruppe DES FLUGS verwalten darf
 * (canManageDroneGroupFor - Bezirksadmin, Bezirks-Drohnenadmin, Abschnittsadmin des verankerten
 * Abschnitts, oder Admin Drohnengruppe der eigenen Gruppe) oder der Ersteller selbst - Letzteres
 * bewusst gruppenunabhängig, ein Mitglied durfte seinen eigenen erfassten Flug schon vor dieser
 * Einschränkung gruppenübergreifend bearbeiten und soll das weiterhin dürfen. `flight.droneGroupId`/
 * `organizationId` sind die Gruppe des Flugs selbst (über seine Drohne aufgelöst, siehe Kommentar an
 * den Aufrufstellen) - DroneFlight trägt keine eigenen Spalten dafür.
 */
export function canManageFlight(
  user: SessionUser,
  flight: { registeredById: string; droneGroupId: string; organizationId: string },
): boolean {
  return (
    canManageDroneGroupFor(user, { id: flight.droneGroupId, organizationId: flight.organizationId }) ||
    flight.registeredById === user.id
  );
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
    user.isBezirksDrohnenAdmin ||
    canManageAbschnittFor(user, droneGroup.organizationId) ||
    (user.droneGroupRole === 'ADMIN' && user.droneGroupId === droneGroup.id)
  );
}

/**
 * Darf den bezirksweiten Drohnengruppen-Termin (droneGroupId === null, sichtbar für alle 4 Gruppen)
 * anlegen/bearbeiten/löschen: nur Bezirksadmin oder Bezirks-Drohnenadmin - bewusst kein
 * Abschnittsadmin und kein einzelner Admin Drohnengruppe, weil der Termin über die Grenzen einer
 * einzelnen Gruppe/eines einzelnen Abschnitts hinausgeht.
 */
export function canManageBezirksWideDroneEvent(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/**
 * Einheitliche Anlegen/Bearbeiten/Löschen-Berechtigung für einen Termin - kategorieabhängig:
 * - Kategorie DROHNENGRUPPE, droneGroupId gesetzt: nur canManageDroneGroupFor der jeweiligen Gruppe
 *   (bewusst NICHT die bloße eigene Mitgliedschaft - ein einfaches Mitglied/Pilot ohne Admin-Rolle
 *   soll hierüber keine Termine anlegen dürfen, siehe Design-Spec Abschnitt 4.2).
 * - Kategorie DROHNENGRUPPE, droneGroupId null (bezirksweit): nur canManageBezirksWideDroneEvent.
 * - Kategorie ALLGEMEIN: unverändert canManageEventsFor - dieser Zweig darf durch die
 *   Drohnengruppen-Erweiterung nicht angefasst werden, ein Feuerwehr-Admin verwaltet weiterhin
 *   ausschließlich Termine der eigenen Feuerwehr(en).
 * `droneGroup` muss der Aufrufer selbst laden (null, wenn droneGroupId null ist oder die Gruppe aus
 * irgendeinem Grund nicht mehr existiert) - diese Funktion hat keinen DB-Zugriff.
 */
export function canManageEvent(
  user: SessionUser,
  event: { organizationId: string; category: string; droneGroupId: string | null },
  droneGroup: { id: string; organizationId: string } | null,
): boolean {
  if (event.category === 'DROHNENGRUPPE') {
    if (event.droneGroupId === null) return canManageBezirksWideDroneEvent(user);
    return droneGroup !== null && canManageDroneGroupFor(user, droneGroup);
  }
  return canManageEventsFor(user, event.organizationId);
}

/** Wer darf isBezirksAdmin bei einem ANDEREN Benutzer setzen/entziehen - nur bestehende Bezirksadmins. */
export function canGrantBezirksAdmin(currentUser: SessionUser): boolean {
  return isBezirksAdmin(currentUser);
}

/** Wer darf isBezirksDrohnenAdmin bei einem ANDEREN Benutzer setzen/entziehen - ein Bezirksadmin ODER
 * ein bestehender Bezirks-Drohnenadmin (bewusst weiter gefasst als canGrantBezirksAdmin, siehe Design-Spec).
 * Hinweis: ein reiner Bezirks-Drohnenadmin (ohne eigene Feuerwehr-/Abschnitts-Admin-Mitgliedschaft) erreicht
 * die Benutzerverwaltung selbst gar nicht (siehe canAccessUserManagementAdmin/canManageUsersFor) - die
 * weitere Vergabe wirkt also nur für jemanden, der ZUGLEICH Bezirks-Drohnenadmin UND Feuerwehr-/
 * Abschnitts-Admin ist. */
export function canGrantBezirksDrohnenAdmin(currentUser: SessionUser): boolean {
  return isBezirksAdmin(currentUser) || currentUser.isBezirksDrohnenAdmin;
}

/**
 * Sichtbarkeit der Seite /admin/bezirksverwaltung generell - Bezirksadmin ODER Bezirks-Drohnenadmin.
 * Reines Seiten-Gate: welche der drei Sektionen innerhalb der Seite tatsächlich rendert, entscheiden
 * canManageFeuerwehrenBezirksweit/canManageDrohnengruppenBezirksweit unten - ein reiner
 * Bezirks-Drohnenadmin erreicht die Seite über diese Funktion, sieht dort aber ausschließlich den
 * Drohnengruppen-Abschnitt.
 */
export function canAccessBezirksverwaltung(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/** Feuerwehren-Abschnitt (Anlegen/Umbenennen/Deaktivieren) + Bezirksadmin-Liste - exklusiv Bezirksadmin. */
export function canManageFeuerwehrenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}

/** Sondergruppen-Verwaltung (Anlegen/Umbenennen/Aktivieren/Deaktivieren) - exklusiv Bezirksadmin: eine
 * Sondergruppe ist (anders als DroneGroup) an keinem Abschnitt verankert, und es gibt keine eigene
 * Sondergruppen-Admin-Rolle (siehe Design-Spec). */
export function canManageSondergruppenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}

/**
 * Drohnengruppen-Abschnitt (Anlegen/Umbenennen/Deaktivieren) - Bezirksadmin ODER Bezirks-Drohnenadmin.
 * Bewusst NICHT canManageDroneGroupFor wiederverwendet: jene Funktion prüft Rechte für eine
 * BESTEHENDE, bereits verankerte Gruppe (inkl. Abschnittsadmin/Gruppen-Admin) - das Anlegen einer
 * NEUEN Gruppe ist ein bezirksweiter Strukturakt, bewusst enger gefasst auf die beiden bezirksweiten
 * Rollen.
 */
export function canManageDrohnengruppenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/**
 * News-Modul: Senderecht für eine konkrete Feuerwehr - Admin dieser Feuerwehr (canManageHeimatfeuerwehrFor,
 * das bereits Bezirksadmin miteinschließt) statt der bisherigen, ausschließlich auf Bezirksadmin
 * beschränkten Regel (siehe git-history dieser Datei für den alten Kommentar dazu) - explizit mit dem
 * App-Betreiber als gewünschte Rechte-Ausweitung bestätigt.
 */
export function canSendNewsToFireDepartment(user: SessionUser, fireDepartmentId: string): boolean {
  return canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/** News-Modul: Senderecht für eine konkrete Drohnengruppe - identische Regel wie canManageDroneGroupFor
 * (Bezirksadmin, Bezirks-Drohnenadmin, Abschnittsadmin des verankerten Abschnitts, oder Admin dieser
 * Gruppe). */
export function canSendNewsToDroneGroup(user: SessionUser, droneGroup: { id: string; organizationId: string }): boolean {
  return canManageDroneGroupFor(user, droneGroup);
}

/** News-Modul: Senderecht für eine bezirksweite Drohnengruppen-News (droneGroupId leer = alle Gruppen) -
 * bewusst enger als canSendNewsToDroneGroup für eine einzelne Gruppe, exakt dieselbe Einschränkung wie
 * canManageBezirksWideDroneEvent im Kalender-Modul: ein einzelner Gruppen-Admin soll nicht über die
 * Grenzen seiner eigenen Gruppe hinaus an alle vier Gruppen senden dürfen. */
export function canSendBezirksWideDroneNews(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/** News-Modul: Beitrag bearbeiten/löschen - Ersteller ODER Admin des Empfängerkreises. droneGroup ist
 * ein bereits geladenes Objekt ({id, organizationId}), NIE ein impliziter zweiter Prisma-Aufruf hier
 * drinnen - exakt dasselbe Muster wie canManageEvent(user, event, droneGroup) im Kalender-Modul. */
export function canManageNewsPost(
  user: SessionUser,
  post: { createdById: string; audience: NewsAudience; fireDepartmentId: string | null; droneGroupId: string | null },
  droneGroup: { id: string; organizationId: string } | null,
): boolean {
  if (post.createdById === user.id) return true;
  if (post.audience === 'FIRE_DEPARTMENT') return canSendNewsToFireDepartment(user, post.fireDepartmentId!);
  if (post.droneGroupId === null) return canSendBezirksWideDroneNews(user);
  return droneGroup !== null && canSendNewsToDroneGroup(user, droneGroup);
}

/** News-Modul: darf IRGENDEINEN Empfängerkreis ansprechen - steuert nur, ob "Verfassen"/die
 * Entwürfe-Verwaltung überhaupt sichtbar sind, keine Autorisierung für eine konkrete Aktion. */
export function canSendAnyNews(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin || user.feuerwehrAdminOrgIds.length > 0 || user.droneGroupRole === 'ADMIN';
}

/**
 * Sichtbarkeit eines einzelnen Termins - kategorieabhängig, identische Regel wie die
 * Kalenderübersicht-Query selbst (muss bei einer Änderung hier immer mitgezogen werden,
 * siehe kalender/page.tsx):
 * - Kategorie DROHNENGRUPPE ist VÖLLIG UNABHÄNGIG von organizationId/isSectionWide/isDistrictWide -
 *   sichtbar mit Modulzugriff UND (droneGroupId null [bezirksweit, alle 4 Gruppen] ODER droneGroupId
 *   exakt die eigene Gruppe).
 * - Kategorie ALLGEMEIN: eigene Feuerwehr ODER abschnittsweit innerhalb des eigenen Abschnitts ODER
 *   isDistrictWide (bezirksweit, sichtbar für jeden im Bezirk unabhängig von Organisation/Abschnitt -
 *   siehe docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md). `eventAbschnittOrganizationId`
 *   muss der Aufrufer selbst via getAbschnittOrganizationId(event.organization) berechnen - diese
 *   Funktion hat keinen DB-Zugriff.
 */
export function canViewEvent(
  user: SessionUser,
  event: {
    organizationId: string;
    isSectionWide: boolean;
    isDistrictWide: boolean;
    category: string;
    eventAbschnittOrganizationId: string;
    droneGroupId: string | null;
  },
): boolean {
  if (event.category === 'DROHNENGRUPPE') {
    return canViewDroneModule(user) && (event.droneGroupId === null || event.droneGroupId === user.droneGroupId);
  }
  return (
    event.organizationId === user.homeOrganizationId ||
    (event.isSectionWide && event.eventAbschnittOrganizationId === user.homeAbschnittOrganizationId) ||
    event.isDistrictWide
  );
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

/**
 * Sichtbarkeit von Foto Uploads/Fotos einer Feuerwehr (Foto-Upload-Brief.md §2) - jedes Mitglied
 * dieser Feuerwehr (gleiche homeOrganizationId) ODER wer sie administrativ verwaltet
 * (canManageHeimatfeuerwehrFor). Fotos hochladen nutzt exakt dieselbe Regel - kein separates
 * canUploadPhotoFor nötig.
 */
export function canViewPhotoUploadsFor(user: SessionUser, fireDepartmentId: string): boolean {
  return user.homeOrganizationId === fireDepartmentId || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/**
 * Foto Upload anlegen/bearbeiten/löschen - laut App-Betreiber (Chat-Rückfrage, der Brief nennt
 * weiterhin "Kommandant/Einsatzleiter/Schriftführer") dieselbe Regel wie canViewPhotoUploadsFor:
 * jedes Mitglied der Feuerwehr darf, keine Rollen-Einschränkung, da dieses Projekt keine
 * Rollentabelle kennt. Eigene, benannte Funktion statt canViewPhotoUploadsFor direkt an den
 * Aufrufstellen wiederzuverwenden, falls sich das künftig doch trennt - gleiches Muster wie
 * canManageUsersFor/canManageHeimatfeuerwehrFor in diesem Projekt.
 */
export function canManagePhotoUploadsFor(user: SessionUser, fireDepartmentId: string): boolean {
  return canViewPhotoUploadsFor(user, fireDepartmentId);
}

/** Foto löschen - der Uploader selbst ODER ein Admin der Feuerwehr (canManageHeimatfeuerwehrFor),
 * NICHT jedes beliebige Mitglied (anders als canViewPhotoUploadsFor/canManagePhotoUploadsFor). Kein
 * canTogglePhotoRelease-Gegenstück mehr nötig - es gibt kein Freigabe-Feld. */
export function canDeletePhoto(
  user: SessionUser,
  photo: { uploadedById: string },
  fireDepartmentId: string,
): boolean {
  return photo.uploadedById === user.id || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/**
 * Darf currentUser den DATENSATZ von targetUser überhaupt anfassen (bearbeiten, aktivieren/
 * deaktivieren, Feuerwehr wechseln, löschen, Passwort-Reset auslösen) - zusätzlich zur reinen
 * Org-Zugehörigkeits-Prüfung (canManageUsersFor) auch die RECHTESTUFE des Ziels selbst. Ohne das:
 * ein Feuerwehr-Admin, der zufällig dieselbe Heimatfeuerwehr wie ein Bezirksadmin/Bezirks-
 * Drohnenadmin verwaltet, durfte dessen Datensatz genauso anfassen wie den jedes anderen
 * Mitglieds seiner Feuerwehr - inklusive E-Mail-Adresse ändern + Passwort-Reset auslösen, ohne
 * die Bezirksadmin-Checkbox selbst je anzurühren (die einzige Stelle, die bisher eine
 * Eskalations-Prüfung auslöste). Security-Review S1, verifiziert an admin/benutzer/actions.ts.
 */
export function canManageUserRecord(
  currentUser: SessionUser,
  targetUser: { homeOrganizationId: string; isBezirksAdmin: boolean; isBezirksDrohnenAdmin: boolean },
): boolean {
  if (!canManageUsersFor(currentUser, targetUser.homeOrganizationId)) {
    return false;
  }
  if (targetUser.isBezirksAdmin && !isBezirksAdmin(currentUser)) {
    return false;
  }
  if (targetUser.isBezirksDrohnenAdmin && !canGrantBezirksDrohnenAdmin(currentUser)) {
    return false;
  }
  return true;
}

/** Sichtbarkeit des Verwaltungsmenüs "Benutzer" - Site-Admin ODER Admin von mindestens einer
 * Feuerwehr (analog canAccessHeimatfeuerwehrAdmin). */
export function canAccessUserManagementAdmin(user: SessionUser): boolean {
  return canAccessHeimatfeuerwehrAdmin(user);
}

/**
 * Welche der BESTEHENDEN Admin-Mitgliedschaften eines Benutzers darf `currentUser` beim Speichern des
 * Benutzerformulars entfernen? Antwort: nur solche, die (a) in der neuen Auswahl nicht mehr vorkommen
 * UND (b) für eine Organisation gelten, die currentUser selbst verwalten darf.
 *
 * Als eigene, reine Funktion herausgezogen, weil die frühere Inline-Variante in
 * admin/benutzer/actions.ts (`deleteMany({ organizationId: { notIn: adminOrgIds } })`) eine echte
 * Rechte-Lücke hatte: sie war nur nach userId/role gescoped. Bei leerem nextAdminOrgIds passierte
 * `canGrantAdminFor([])` leer-wahr und `notIn: []` schloss nichts aus - es wurden ALLE
 * Admin-Mitgliedschaften des Zielbenutzers gelöscht, auch die für Organisationen außerhalb des
 * Verwaltungsbereichs des Aufrufers (z. B. ein Abschnittskommando).
 */
export function filterRemovableAdminOrgIds(
  currentUser: SessionUser,
  currentAdminOrgIds: string[],
  nextAdminOrgIds: string[],
): string[] {
  return currentAdminOrgIds
    .filter((organizationId) => !nextAdminOrgIds.includes(organizationId))
    .filter((organizationId) => canManageUsersFor(currentUser, organizationId));
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
