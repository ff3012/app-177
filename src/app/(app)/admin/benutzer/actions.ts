'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DroneRole, MembershipRole, Prisma, TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageUsersFor } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/password';
import { createToken } from '@/lib/auth/tokens';
import { sendActivationEmail, sendPasswordResetEmail } from '@/lib/email/templates';
import { type DroneRoleOption, parseUserFormData, userSchema } from '@/lib/validation/user.schema';
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

async function syncAdminMemberships(userId: string, adminOrgIds: string[]) {
  await prisma.membership.deleteMany({
    where: { userId, role: MembershipRole.ADMIN, organizationId: { notIn: adminOrgIds } },
  });
  for (const organizationId of adminOrgIds) {
    await prisma.membership.upsert({
      where: { userId_organizationId_role: { userId, organizationId, role: MembershipRole.ADMIN } },
      update: {},
      create: { userId, organizationId, role: MembershipRole.ADMIN },
    });
  }
}

async function syncDroneMembership(userId: string, droneRole: DroneRoleOption) {
  if (droneRole === 'NONE') {
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId } });
    return;
  }
  const role = droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT;
  await prisma.drohnengruppeMembership.upsert({
    where: { userId },
    update: { role },
    create: { userId, role },
  });
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
      homeOrganizationId: data.homeOrganizationId,
      passwordHash,
    },
  });

  await syncAdminMemberships(user.id, data.adminOrgIds);
  await syncDroneMembership(user.id, data.droneRole);

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
  // noch ihn zu einer fremden Feuerwehr verschieben.
  assertPermission(canManageUsersFor(currentUser, targetUser.homeOrganizationId));

  const raw = parseUserFormData(formData);
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));

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
      homeOrganizationId: data.homeOrganizationId,
      ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
    },
  });

  await syncAdminMemberships(userId, data.adminOrgIds);
  await syncDroneMembership(userId, data.droneRole);

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}

export interface PasswordResetEmailState {
  success?: boolean;
  error?: string;
}

export async function sendPasswordResetEmailToUser(userId: string): Promise<PasswordResetEmailState> {
  const currentUser = await requireUser();

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  assertPermission(canManageUsersFor(currentUser, targetUser.homeOrganizationId));

  try {
    const token = await createToken(targetUser.id, TokenPurpose.PASSWORD_RESET);
    await sendPasswordResetEmail(targetUser, token);
  } catch (error) {
    console.error('Passwort-Reset-E-Mail fehlgeschlagen:', error);
    return { error: 'E-Mail konnte nicht gesendet werden. Bitte Mailjet-Konfiguration prüfen.' };
  }

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
  assertPermission(canManageUsersFor(currentUser, targetUser.homeOrganizationId));

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
    select: { id: true, homeOrganizationId: true },
  });
  assertPermission(targetUsers.every((u) => canManageUsersFor(currentUser, u.homeOrganizationId)));

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
    select: { id: true, homeOrganizationId: true },
  });
  assertPermission(targetUsers.every((u) => canManageUsersFor(currentUser, u.homeOrganizationId)));

  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { homeOrganizationId: organizationId } });
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
  assertPermission(canManageUsersFor(currentUser, targetUser.homeOrganizationId));

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return {
        error:
          'Dieser Benutzer kann nicht gelöscht werden, da er Termine, Drohnenflüge oder News angelegt hat. Bitte stattdessen deaktivieren ("Konto aktiv" entfernen).',
      };
    }
    throw error;
  }

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}