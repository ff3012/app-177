'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DroneRole, MembershipRole, Prisma, TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import {
  assertPermission,
  canGrantBezirksAdmin,
  canGrantBezirksDrohnenAdmin,
  canManageDroneGroupFor,
  canManageUserRecord,
  canManageUsersFor,
  filterRemovableAdminOrgIds,
} from '@/lib/auth/permissions';
import { FEUERWEHR_KATEGORIE_LABEL } from '@/lib/organizations/feuerwehr-kategorie';
import { hashPassword } from '@/lib/password';
import { createToken } from '@/lib/auth/tokens';
import { sendActivationEmail, sendPasswordResetEmail } from '@/lib/email/templates';
import {
  AUSBILDUNGSSTUFEN,
  type Ausbildungsstufe,
  type DroneRoleOption,
  parseUserFormData,
  userSchema,
} from '@/lib/validation/user.schema';
import type { SessionUser } from '@/types/next-auth';

export interface UserFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  activationLink?: string;
}

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

/** Ein Feuerwehr-Admin darf "Admin für" nur für Feuerwehren vergeben, die er selbst verwaltet -
 * sonst könnte er über die Benutzerverwaltung Admin-Rechte für fremde Feuerwehren verteilen. Die
 * UI (organizations-Prop in page.tsx) bietet einem Feuerwehr-Admin ohnehin nur die eigene(n)
 * Feuerwehr(en) als Checkbox-Optionen an - dies ist die serverseitige Absicherung gegen einen
 * direkten Server-Action-Aufruf, der diese UI-Einschränkung umgeht. */
function canGrantAdminFor(currentUser: SessionUser, adminOrgIds: string[]): boolean {
  return adminOrgIds.every((organizationId) => canManageUsersFor(currentUser, organizationId));
}

/**
 * canGrantAdminFor oben deckt nur das HINZUFÜGEN ab. Beim Entfernen wurde vorher pauschal
 * `deleteMany({ organizationId: { notIn: adminOrgIds } })` ausgeführt - nur nach userId/role gescoped,
 * ohne zu prüfen, ob der Aufrufer die dabei gelöschte Organisation überhaupt verwalten darf. Bei einem
 * leeren adminOrgIds-Array (UI-Fehler oder direkter Server-Action-Aufruf) passierte canGrantAdminFor([])
 * leer-wahr und `notIn: []` schloss nichts aus - es wurden ALLE Admin-Mitgliedschaften des Zielbenutzers
 * gelöscht, auch die für fremde Organisationen (z. B. ein Abschnittskommando). Daher wird die zu
 * löschende Menge jetzt explizit ermittelt und auf Organisationen im eigenen Verwaltungsbereich gefiltert:
 * eine Mitgliedschaft für eine Organisation, über die der Aufrufer kein Recht hat, bleibt unangetastet.
 */
async function syncAdminMemberships(currentUser: SessionUser, userId: string, adminOrgIds: string[]) {
  const existingAdminMemberships = await prisma.membership.findMany({
    where: { userId, role: MembershipRole.ADMIN },
    select: { organizationId: true },
  });
  const removableOrgIds = filterRemovableAdminOrgIds(
    currentUser,
    existingAdminMemberships.map((m) => m.organizationId),
    adminOrgIds,
  );

  if (removableOrgIds.length > 0) {
    await prisma.membership.deleteMany({
      where: { userId, role: MembershipRole.ADMIN, organizationId: { in: removableOrgIds } },
    });
  }
  for (const organizationId of adminOrgIds) {
    await prisma.membership.upsert({
      where: { userId_organizationId_role: { userId, organizationId, role: MembershipRole.ADMIN } },
      update: {},
      create: { userId, organizationId, role: MembershipRole.ADMIN },
    });
  }
}

type AusbildungsDaten = Record<Ausbildungsstufe, string>;

function toAusbildungsUpdate(daten: AusbildungsDaten) {
  return {
    a1a3LizenzAm: daten.a1a3LizenzAm ? new Date(daten.a1a3LizenzAm) : null,
    a2LizenzAm: daten.a2LizenzAm ? new Date(daten.a2LizenzAm) : null,
    stuetzpunktausbildungAm: daten.stuetzpunktausbildungAm ? new Date(daten.stuetzpunktausbildungAm) : null,
    bos1AusbildungAm: daten.bos1AusbildungAm ? new Date(daten.bos1AusbildungAm) : null,
    bos2AusbildungAm: daten.bos2AusbildungAm ? new Date(daten.bos2AusbildungAm) : null,
  };
}

/**
 * Die Drohnengruppe wird vom Client mitgeschickt - ohne eigene Prüfung konnte sich damit JEDER, der
 * überhaupt in die Benutzerverwaltung kommt (auch ein reiner Feuerwehr-Admin, siehe
 * canAccessUserManagementAdmin), am eigenen Datensatz die ADMIN-Rolle einer BELIEBIGEN der Gruppen
 * geben - inklusive einer an einem fremden Abschnitt verankerten - und damit deren Drohnen, Unterlagen,
 * Mitgliederliste, Benachrichtigungsadresse und den öffentlichen QR-Schnellerfassungs-Token übernehmen.
 * canManageDroneGroupFor ist dieselbe Funktion, die /admin/drohnen absichert; hier gilt sie für die
 * Frage "wer darf jemanden IN diese Gruppe aufnehmen/daraus entfernen".
 *
 * Geprüft wird nur, wenn sich an der Mitgliedschaft tatsächlich etwas ändert - sonst könnte ein
 * Feuerwehr-Admin einen Benutzer seiner Feuerwehr, der zufällig in einer fremden Drohnengruppe ist,
 * überhaupt nicht mehr bearbeiten (das Formular schickt dessen unveränderte Gruppe ja immer mit).
 * Ändert sich etwas, müssen BEIDE betroffenen Gruppen (bisherige und neue) im Recht des Aufrufers
 * liegen - sonst ließe sich über droneRole='NONE' eine fremde Gruppenmitgliedschaft entfernen.
 *
 * Seit der Ausbildungsstufen-Erweiterung gilt dieselbe Prüfung auch für eine reine
 * Ausbildungsdaten-Änderung ohne Rollen-/Gruppenwechsel (siehe ausbildungChanged unten).
 */
async function syncDroneMembership(
  currentUser: SessionUser,
  userId: string,
  droneRole: DroneRoleOption,
  droneGroupId: string | null,
  ausbildung: AusbildungsDaten,
) {
  const existing = await prisma.drohnengruppeMembership.findUnique({ where: { userId } });
  const currentRole: DroneRoleOption = !existing ? 'NONE' : existing.role === DroneRole.ADMIN ? 'ADMIN' : 'PILOT';
  const currentGroupId = existing?.droneGroupId ?? null;
  const targetGroupId = droneRole === 'NONE' ? null : droneGroupId;

  const ausbildungChanged =
    existing !== null &&
    AUSBILDUNGSSTUFEN.some((key) => {
      const current = existing[key];
      const currentStr = current ? current.toISOString().slice(0, 10) : '';
      return currentStr !== ausbildung[key];
    });

  if (currentRole === droneRole && currentGroupId === targetGroupId && !ausbildungChanged) {
    return;
  }

  const affectedGroupIds = Array.from(
    new Set([currentGroupId, targetGroupId].filter((id): id is string => Boolean(id))),
  );
  for (const groupId of affectedGroupIds) {
    const group = await prisma.droneGroup.findUnique({
      where: { id: groupId },
      select: { id: true, organizationId: true },
    });
    assertPermission(
      group !== null && canManageDroneGroupFor(currentUser, group),
      'Keine Berechtigung, Mitglieder dieser Drohnengruppe zu verwalten.',
    );
  }

  if (droneRole === 'NONE') {
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId } });
    return;
  }
  if (!droneGroupId) {
    throw new Error('Drohnengruppe ist erforderlich, wenn eine Rolle gewählt wurde.');
  }
  const role = droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT;
  const ausbildungUpdate = toAusbildungsUpdate(ausbildung);
  await prisma.drohnengruppeMembership.upsert({
    where: { userId },
    update: { role, droneGroupId, ...ausbildungUpdate },
    create: { userId, role, droneGroupId, ...ausbildungUpdate },
  });
}

/**
 * Prüft die Design-Regel aus docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md:
 * secondaryOrganizationId muss auf eine andere feuerwehrKategorie zeigen als homeOrganizationId
 * (eine FF + eine BTF, nie zwei vom selben Typ). Nur app-seitig geprüft (kein DB-Constraint), da
 * beide Kategorien serverseitig geladen werden müssen - kann nicht als synchrones Zod-.refine()
 * ausgedrückt werden. Gibt bei Verletzung ein fieldErrors-Objekt zurück (gleiche Form wie
 * userSchema.safeParse's eigene Fehler), sonst null.
 */
async function validateSecondaryOrganizationCategory(
  homeOrganizationId: string,
  secondaryOrganizationId: string,
): Promise<UserFormState['fieldErrors'] | null> {
  if (!secondaryOrganizationId) return null;
  const [home, secondary] = await Promise.all([
    prisma.organization.findUnique({ where: { id: homeOrganizationId }, select: { feuerwehrKategorie: true } }),
    prisma.organization.findUnique({ where: { id: secondaryOrganizationId }, select: { feuerwehrKategorie: true } }),
  ]);
  if (!home || !secondary) {
    return { secondaryOrganizationId: ['Feuerwehr wurde nicht gefunden.'] };
  }
  if (home.feuerwehrKategorie === secondary.feuerwehrKategorie) {
    const label = FEUERWEHR_KATEGORIE_LABEL[home.feuerwehrKategorie];
    const otherLabel =
      home.feuerwehrKategorie === 'FREIWILLIGE_FEUERWEHR'
        ? FEUERWEHR_KATEGORIE_LABEL.BETRIEBSFEUERWEHR
        : FEUERWEHR_KATEGORIE_LABEL.FREIWILLIGE_FEUERWEHR;
    return {
      secondaryOrganizationId: [
        `Diese Feuerwehr hat dieselbe Kategorie (${label}) wie die Heimat-Feuerwehr — bitte eine ${otherLabel} wählen.`,
      ],
    };
  }
  return null;
}

export async function createUser(_prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  const currentUser = await requireUser();

  const raw = parseUserFormData(formData);
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // Ein Feuerwehr-Admin darf neue Benutzer NUR mit seiner eigenen Feuerwehr als Heimat-Feuerwehr
  // anlegen (siehe canManageUsersFor-Kommentar) - und Admin-Rechte nur für Feuerwehren vergeben,
  // die er selbst verwaltet.
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
  if (data.secondaryOrganizationId) {
    assertPermission(canManageUsersFor(currentUser, data.secondaryOrganizationId));
    const categoryError = await validateSecondaryOrganizationCategory(data.homeOrganizationId, data.secondaryOrganizationId);
    if (categoryError) {
      return { fieldErrors: categoryError };
    }
  }
  if (data.isBezirksAdmin) {
    assertPermission(canGrantBezirksAdmin(currentUser));
  }
  if (data.isBezirksDrohnenAdmin) {
    assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    return { error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' };
  }

  // Unbenutzbarer Platzhalter-Hash: der Benutzer setzt sein eigenes Passwort über den Aktivierungslink.
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const user = await prisma.user.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      stbNr: data.stbNr || null,
      phone: data.phone || null,
      isActive: false,
      istAtemschutzgeraeteTraeger: data.istAtemschutzgeraeteTraeger,
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      secondaryOrganizationId: data.secondaryOrganizationId || null,
      // Ohne zweite Feuerwehr darf kein Dienstgrad dafür bestehen bleiben - siehe Kommentar bei
      // updateUser unten, dieselbe Regel gilt hier fürs Anlegen.
      secondaryDienstgradId: data.secondaryOrganizationId ? data.secondaryDienstgradId || null : null,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
      passwordHash,
    },
  });

  await syncAdminMemberships(currentUser, user.id, data.adminOrgIds);
  await syncDroneMembership(currentUser, user.id, data.droneRole, data.droneGroupId, {
    a1a3LizenzAm: data.a1a3LizenzAm,
    a2LizenzAm: data.a2LizenzAm,
    stuetzpunktausbildungAm: data.stuetzpunktausbildungAm,
    bos1AusbildungAm: data.bos1AusbildungAm,
    bos2AusbildungAm: data.bos2AusbildungAm,
  });

  const token = await createToken(user.id, TokenPurpose.ACTIVATION);

  if (!data.sendWelcomeEmail) {
    // Kein Mail-Versand gewünscht: Aktivierungslink stattdessen dem Admin zum manuellen Weitergeben anzeigen.
    revalidatePath('/admin/benutzer');
    return { success: true, activationLink: `${baseUrl()}/aktivieren/${token}` };
  }

  try {
    await sendActivationEmail(user, token);
  } catch (error) {
    console.error('Fehler beim Senden der Aktivierungs-E-Mail:', error);
    return {
      error:
        'Benutzer wurde angelegt, aber die Aktivierungs-E-Mail konnte nicht gesendet werden. Bitte Mailjet-Konfiguration prüfen.',
    };
  }

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}

export async function updateUser(
  userId: string,
  _prevState: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const currentUser = await requireUser();

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  // Berechtigung gilt sowohl für die BISHERIGE als auch (falls geändert) die NEUE Heimat-Feuerwehr -
  // ein Feuerwehr-Admin darf einen Benutzer weder verwalten, der nicht zu seiner Feuerwehr gehört,
  // noch ihn zu einer fremden Feuerwehr verschieben. canManageUserRecord prüft zusätzlich die
  // RECHTESTUFE des Ziels (Security-Review S1) - reines canManageUsersFor hätte einem
  // Feuerwehr-Admin erlaubt, einen zufällig in seiner Feuerwehr befindlichen Bezirksadmin über eine
  // E-Mail-Änderung + Passwort-Reset zu übernehmen, ohne die Bezirksadmin-Checkbox anzurühren.
  assertPermission(canManageUserRecord(currentUser, targetUser));

  const raw = parseUserFormData(formData);
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
  // Nur geprüft, wenn sich die zweite Feuerwehr tatsächlich ändert - sonst würde JEDE Bearbeitung
  // eines Benutzers mit einer zweiten Feuerwehr außerhalb des eigenen Verwaltungsbereichs
  // fehlschlagen (typischer Fall: ein Feuerwehr-Admin bearbeitet ein unverändertes Feld bei einem
  // Benutzer, dessen zweite Feuerwehr - eine BTF - vorher von einem Bezirksadmin zugewiesen wurde),
  // exakt dasselbe Änderungs-gescopte Muster wie bei isBezirksAdmin/isBezirksDrohnenAdmin unten.
  // Ändert sich der Wert (Zuweisung, Wechsel ODER Entfernen), braucht der Aufrufer Rechte über BEIDE
  // betroffenen Organisationen - die bisherige (falls gesetzt) und die neue (falls gesetzt) - sonst
  // könnte er über einen geleerten Wert eine fremde Zuweisung entfernen, ohne selbst Rechte über die
  // bisherige Organisation zu haben, oder eine neue fremde Organisation zuweisen.
  if (data.secondaryOrganizationId !== (targetUser.secondaryOrganizationId ?? '')) {
    if (targetUser.secondaryOrganizationId) {
      assertPermission(canManageUsersFor(currentUser, targetUser.secondaryOrganizationId));
    }
    if (data.secondaryOrganizationId) {
      assertPermission(canManageUsersFor(currentUser, data.secondaryOrganizationId));
    }
  }
  if (data.secondaryOrganizationId) {
    const categoryError = await validateSecondaryOrganizationCategory(data.homeOrganizationId, data.secondaryOrganizationId);
    if (categoryError) {
      return { fieldErrors: categoryError };
    }
  }
  if (data.isBezirksAdmin !== targetUser.isBezirksAdmin) {
    assertPermission(canGrantBezirksAdmin(currentUser));
  }
  if (data.isBezirksDrohnenAdmin !== targetUser.isBezirksDrohnenAdmin) {
    assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
  }
  if (currentUser.id === userId && targetUser.isBezirksAdmin && !data.isBezirksAdmin) {
    return { error: 'Du kannst dir den Bezirksadmin-Status nicht selbst entziehen.' };
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing && existing.id !== userId) {
    return { error: 'Ein anderer Benutzer verwendet diese E-Mail-Adresse bereits.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      stbNr: data.stbNr || null,
      phone: data.phone || null,
      isActive: data.isActive,
      istAtemschutzgeraeteTraeger: data.istAtemschutzgeraeteTraeger,
      dienstgradId: data.dienstgradId || null,
      homeOrganizationId: data.homeOrganizationId,
      secondaryOrganizationId: data.secondaryOrganizationId || null,
      // Server ist die Autorität, nicht nur das Client-UI (gleiches Muster wie syncDroneMembership's
      // droneRole==='NONE'-Zweig): wird die zweite Feuerwehr geleert, ohne dass das UI den zugehörigen
      // Dienstgrad zurücksetzt (oder bei einem direkten Server-Action-Aufruf), darf trotzdem kein
      // Dienstgrad einer nicht mehr vorhandenen zweiten Feuerwehr in der DB überleben.
      secondaryDienstgradId: data.secondaryOrganizationId ? data.secondaryDienstgradId || null : null,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
    },
  });

  await syncAdminMemberships(currentUser, userId, data.adminOrgIds);
  await syncDroneMembership(currentUser, userId, data.droneRole, data.droneGroupId, {
    a1a3LizenzAm: data.a1a3LizenzAm,
    a2LizenzAm: data.a2LizenzAm,
    stuetzpunktausbildungAm: data.stuetzpunktausbildungAm,
    bos1AusbildungAm: data.bos1AusbildungAm,
    bos2AusbildungAm: data.bos2AusbildungAm,
  });

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}

export interface PasswordResetEmailState {
  success?: boolean;
  error?: string;
}

const RESET_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RESET_RATE_LIMIT_MAX = 3;

export async function sendPasswordResetEmailToUser(userId: string): Promise<PasswordResetEmailState> {
  const currentUser = await requireUser();

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  // Security-Review S1: canManageUserRecord statt canManageUsersFor - siehe Kommentar in updateUser.
  // Über diesen Weg ließe sich sonst ein Passwort-Reset für ein fremdes Bezirksadmin-Konto auslösen.
  assertPermission(canManageUserRecord(currentUser, targetUser));

  // Benutzerverwaltung-Brief.md §3: höchstens drei Reset-Mails je Benutzer und Stunde. Zählt jede
  // in der letzten Stunde erzeugte PASSWORD_RESET-Token-Zeile für diesen Benutzer - unabhängig
  // davon, ob sie von hier (Admin-Button) oder über die separate Self-Service-"Passwort
  // vergessen"-Seite ausgelöst wurde (die ihr eigenes, unabhängiges Throttling hat); ein
  // gemeinsames Budget ist hier bewusst strenger, nicht lockerer, als zwei getrennte Zähler.
  const recentResets = await prisma.passwordToken.count({
    where: {
      userId: targetUser.id,
      purpose: TokenPurpose.PASSWORD_RESET,
      createdAt: { gte: new Date(Date.now() - RESET_RATE_LIMIT_WINDOW_MS) },
    },
  });
  if (recentResets >= RESET_RATE_LIMIT_MAX) {
    return { error: 'Zu viele Reset-Mails in der letzten Stunde für diesen Benutzer. Bitte später erneut versuchen.' };
  }

  try {
    const token = await createToken(targetUser.id, TokenPurpose.PASSWORD_RESET);
    await sendPasswordResetEmail(targetUser, token);
  } catch (error) {
    console.error('Passwort-Reset-E-Mail fehlgeschlagen:', error);
    return { error: 'E-Mail konnte nicht gesendet werden. Bitte Mailjet-Konfiguration prüfen.' };
  }

  // Protokollierung "wer wann ausgelöst hat" (Benutzerverwaltung-Brief.md §3) als reines
  // Server-Log, kein persistiertes Audit-Feld.
  console.log(
    `Passwort-Reset für ${targetUser.email} ausgelöst von ${currentUser.email} (${currentUser.id}) um ${new Date().toISOString()}`,
  );

  return { success: true };
}

export interface BulkActionState {
  success?: boolean;
  affectedCount?: number;
  error?: string;
}

/** Dünner Wrapper um ein einzelnes Feld statt des vollen updateUser-Formulars - fürs neue
 * Zeilenmenü "Aktivieren/Deaktivieren" (Verwaltung-Brief.md), das nur isActive umschaltet, ohne
 * den Rest des Formulars erneut zu validieren/senden. Wird auch von bulkSetActive wiederverwendet. */
export async function setUserActive(userId: string, isActive: boolean): Promise<BulkActionState> {
  const currentUser = await requireUser();

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  // Security-Review S1: canManageUserRecord statt canManageUsersFor - sonst könnte ein
  // Feuerwehr-Admin ein fremdes Bezirksadmin-Konto stilllegen (oder wieder aktivieren).
  assertPermission(canManageUserRecord(currentUser, targetUser));

  if (currentUser.id === userId && !isActive) {
    return { error: 'Du kannst dein eigenes Konto nicht deaktivieren.' };
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive } });
  revalidatePath('/admin/benutzer');
  return { success: true, affectedCount: 1 };
}

/** Neu für die Mehrfachauswahl-Aktionsleiste (Verwaltung-Brief.md) - gab es vorher nicht. Schließt
 * beim Deaktivieren das eigene Konto still aus der Auswahl aus (analog zum Einzel-Schutz oben),
 * statt die ganze Aktion wegen eines einzelnen betroffenen Datensatzes abzubrechen. Prüft für
 * einen Feuerwehr-Admin zusätzlich, dass JEDER ausgewählte Benutzer zu einer seiner Feuerwehren
 * gehört - die Tabelle zeigt ihm zwar ohnehin nur diese Benutzer an, aber die Server Action muss
 * das unabhängig von der (clientseitig bereits vorgefilterten) UI selbst absichern. */
export async function bulkSetActive(userIds: string[], isActive: boolean): Promise<BulkActionState> {
  const currentUser = await requireUser();

  const targetUsers = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, homeOrganizationId: true, isBezirksAdmin: true, isBezirksDrohnenAdmin: true },
  });
  // Security-Review S1: canManageUserRecord statt canManageUsersFor - sonst könnte ein
  // Feuerwehr-Admin per direktem Server-Action-Aufruf einen fremden Bezirksadmin aussperren.
  assertPermission(targetUsers.every((u) => canManageUserRecord(currentUser, u)));

  const targetIds = isActive ? userIds : userIds.filter((id) => id !== currentUser.id);
  if (targetIds.length === 0) {
    return { error: 'Keine Änderung möglich (nur das eigene Konto ausgewählt).' };
  }

  await prisma.user.updateMany({ where: { id: { in: targetIds } }, data: { isActive } });
  revalidatePath('/admin/benutzer');
  return { success: true, affectedCount: targetIds.length };
}

/** Neu für die Mehrfachauswahl-Aktionsleiste ("Feuerwehr ändern", Verwaltung-Brief.md) - gab es
 * vorher nicht. Ändert nur homeOrganizationId. Für einen Feuerwehr-Admin müssen sowohl die
 * bisherige Feuerwehr JEDES ausgewählten Benutzers als auch die neue Ziel-Feuerwehr in seinem
 * eigenen Verwaltungsbereich liegen - sonst könnte er Benutzer aus einer fremden Feuerwehr
 * abziehen oder in eine hinein verschieben, die er nicht verwaltet. Die Ziel-Org-ID kommt zwar aus
 * einem <Select> mit nur den ihm erlaubten Organisationen, aber auch das ist nur eine
 * UI-Einschränkung, keine Absicherung gegen einen direkten Aufruf. */
export async function bulkSetHomeOrganization(userIds: string[], organizationId: string): Promise<BulkActionState> {
  const currentUser = await requireUser();

  assertPermission(canManageUsersFor(currentUser, organizationId));

  const targetUsers = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, homeOrganizationId: true, isBezirksAdmin: true, isBezirksDrohnenAdmin: true },
  });
  // Security-Review S1: canManageUserRecord statt canManageUsersFor - dieser Aufruf hatte
  // zusätzlich KEINE Selbstausnahme wie die anderen fünf Aktionen und war damit besonders scharf.
  assertPermission(targetUsers.every((u) => canManageUserRecord(currentUser, u)));

  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { homeOrganizationId: organizationId } });
  // Zweite Feuerwehr/Dienstgrad räumen, falls sie zufällig genau die neue Heimat-Feuerwehr war -
  // sonst bliebe ein Benutzer mit homeOrganizationId === secondaryOrganizationId zurück (ein Zustand,
  // den die normale Bearbeitung/switchHomeOrganization nie erzeugen kann, siehe
  // validateSecondaryOrganizationCategory/updateUser oben). In diesem kaputten Zustand böte das
  // Profil-Dropdown "Wechseln zu X" für die bereits aktive Organisation an, und ein Bestätigen würde
  // nur unsichtbar den Dienstgrad tauschen, ohne dass sich die Organisation sichtbar ändert - dieser
  // zweite updateMany verhindert das, indem er die zweite Feuerwehr für genau die betroffenen
  // Benutzer leert.
  await prisma.user.updateMany({
    where: { id: { in: userIds }, secondaryOrganizationId: organizationId },
    data: { secondaryOrganizationId: null, secondaryDienstgradId: null },
  });
  revalidatePath('/admin/benutzer');
  return { success: true, affectedCount: userIds.length };
}

export interface DeleteUserState {
  error?: string;
}

export async function deleteUser(
  userId: string,
  _prevState: DeleteUserState,
  _formData: FormData,
): Promise<DeleteUserState> {
  const currentUser = await requireUser();

  if (currentUser.id === userId) {
    return { error: 'Du kannst dein eigenes Konto nicht löschen.' };
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  // Security-Review S1: canManageUserRecord statt canManageUsersFor - sonst könnte ein
  // Feuerwehr-Admin einen fremden Bezirksadmin löschen.
  assertPermission(canManageUserRecord(currentUser, targetUser));

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return {
        error:
          'Dieser Benutzer kann nicht gelöscht werden, da er Termine, Drohnenflüge, News oder Fotos angelegt hat. Bitte stattdessen deaktivieren ("Konto aktiv" entfernen).',
      };
    }
    throw error;
  }

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}

export async function approveRegistration(registrationId: string): Promise<{ error?: string }> {
  const currentUser = await requireUser();

  const pending = await prisma.pendingRegistration.findUnique({ where: { id: registrationId } });
  if (!pending) {
    return { error: 'Diese Anfrage wurde bereits bearbeitet.' };
  }
  assertPermission(canManageUsersFor(currentUser, pending.organizationId));

  const existing = await prisma.user.findUnique({ where: { email: pending.email } });
  if (existing) {
    return { error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' };
  }

  // Dieselbe Kernlogik wie createUser() (Zufalls-Passwort, isActive: false), aber ohne createUser()
  // direkt aufzurufen: das ist an FormData, eine Berechtigungsprüfung gegen den AUFRUFENDEN Admin und
  // einen eigenen abschließenden redirect() gekoppelt, was hier nicht passt - eine Registrierung hat
  // keine adminOrgIds/Drohnengruppen-Auswahl zu übernehmen, nur die Kernfelder. Anlegen + Löschen der
  // PendingRegistration-Zeile laufen in EINER Transaktion, damit zwei (fast) gleichzeitige
  // Genehmigungsversuche derselben Anfrage (Doppelklick, zwei offene Tabs) nie einen verwaisten
  // User ohne gelöschte Anfrage oder umgekehrt hinterlassen - der zweite Versuch schlägt komplett
  // fehl (P2025 auf dem delete, da die Zeile schon weg ist) statt einen zweiten User anzulegen.
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  let user: { id: string; email: string; firstName: string; lastName: string };
  try {
    [user] = await prisma.$transaction([
      prisma.user.create({
        data: {
          firstName: pending.firstName,
          lastName: pending.lastName,
          email: pending.email,
          stbNr: pending.stbNr,
          dienstgradId: pending.dienstgradId,
          homeOrganizationId: pending.organizationId,
          isActive: false,
          passwordHash,
        },
      }),
      prisma.pendingRegistration.delete({ where: { id: registrationId } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return { error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' };
      }
      if (error.code === 'P2025') {
        return { error: 'Diese Anfrage wurde bereits bearbeitet.' };
      }
    }
    throw error;
  }

  const token = await createToken(user.id, TokenPurpose.ACTIVATION);

  try {
    await sendActivationEmail(user, token);
  } catch (error) {
    console.error('Fehler beim Senden der Aktivierungs-E-Mail (Registrierung genehmigt):', error);
  }

  revalidatePath('/admin/benutzer');
  return {};
}

export async function rejectRegistration(registrationId: string): Promise<{ error?: string }> {
  const currentUser = await requireUser();

  const pending = await prisma.pendingRegistration.findUnique({ where: { id: registrationId } });
  if (!pending) {
    return {};
  }
  assertPermission(canManageUsersFor(currentUser, pending.organizationId));

  try {
    await prisma.pendingRegistration.delete({ where: { id: registrationId } });
  } catch (error) {
    // Zwischen der obigen Prüfung und diesem delete wurde dieselbe Anfrage bereits von woanders
    // bearbeitet (Doppelklick, zwei offene Tabs) - kein echter Fehler, einfach nichts mehr zu tun.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return {};
    }
    throw error;
  }
  revalidatePath('/admin/benutzer');
  return {};
}