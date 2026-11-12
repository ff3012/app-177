import crypto from 'crypto';
import { TokenPurpose } from '@prisma/client';
import {
  assertPermission,
  canGrantBezirksAdmin,
  canGrantBezirksDrohnenAdmin,
  canManageDroneGroupFor,
  canManageUsersFor,
} from '@/lib/auth/permissions';
import { createToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/password';
import type { UserInput } from '@/lib/validation/user.schema';
import type { SessionUser } from '@/types/next-auth';
import {
  assertGrantMcpAccess,
  canGrantAdminFor,
  syncAdminMemberships,
  syncDroneMembership,
  validateSecondaryOrganizationCategory,
  type FieldErrors,
} from './user-sync';

export type CreateUserResult =
  | { ok: true; user: { id: string; email: string; firstName: string; lastName: string }; activationToken: string }
  | { ok: false; error?: string; fieldErrors?: FieldErrors };

/**
 * Kernlogik "Benutzer anlegen" - gemeinsam von der Server Action createUser (Benutzerverwaltung) und dem
 * MCP-Werkzeug create_user genutzt, damit beide Wege exakt dieselben Prüfungen durchlaufen. `data` ist bereits
 * mit userSchema validiert. Wirft ForbiddenError bei fehlendem Recht (wie bisher assertPermission) und sendet
 * KEINE E-Mail: der Aufrufer entscheidet, ob er die Willkommens-Mail sendet oder den Link anzeigt.
 */
export async function createUserCore(currentUser: SessionUser, data: UserInput): Promise<CreateUserResult> {
  // Ein Feuerwehr-Admin darf neue Benutzer NUR mit seiner eigenen Feuerwehr als Heimat-Feuerwehr
  // anlegen (siehe canManageUsersFor-Kommentar) - und Admin-Rechte nur für Feuerwehren vergeben,
  // die er selbst verwaltet.
  assertPermission(canManageUsersFor(currentUser, data.homeOrganizationId));
  assertPermission(canGrantAdminFor(currentUser, data.adminOrgIds));
  if (data.secondaryOrganizationId) {
    assertPermission(canManageUsersFor(currentUser, data.secondaryOrganizationId));
    const categoryError = await validateSecondaryOrganizationCategory(data.homeOrganizationId, data.secondaryOrganizationId);
    if (categoryError) {
      return { ok: false, fieldErrors: categoryError };
    }
  }
  if (data.isBezirksAdmin) {
    assertPermission(canGrantBezirksAdmin(currentUser));
  }
  if (data.isBezirksDrohnenAdmin) {
    assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
  }
  const requestedMcpAccess = data.mcpAccess ?? 'NONE';
  if (requestedMcpAccess !== 'NONE') {
    await assertGrantMcpAccess(currentUser, { homeOrganizationId: data.homeOrganizationId, mcpAccess: 'NONE' }, requestedMcpAccess);
  }
  // Neu gegenüber der früheren Inline-Fassung: das Recht für die Drohnengruppe wird VOR dem Anlegen geprüft.
  // syncDroneMembership prüft es zwar auch, aber erst nach prisma.user.create - bei fehlendem Recht blieb dadurch
  // ein Benutzer ohne Mitgliedschaft zurück.
  if (data.droneRole !== 'NONE' && data.droneGroupId) {
    const droneGroup = await prisma.droneGroup.findUnique({ where: { id: data.droneGroupId }, select: { id: true, organizationId: true } });
    assertPermission(
      droneGroup !== null && canManageDroneGroupFor(currentUser, droneGroup),
      'Keine Berechtigung, Mitglieder dieser Drohnengruppe zu verwalten.',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    return { ok: false, error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' };
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
      // updateUser, dieselbe Regel gilt hier fürs Anlegen.
      secondaryDienstgradId: data.secondaryOrganizationId ? data.secondaryDienstgradId || null : null,
      isBezirksAdmin: data.isBezirksAdmin,
      isBezirksDrohnenAdmin: data.isBezirksDrohnenAdmin,
      mcpAccess: requestedMcpAccess,
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

  const activationToken = await createToken(user.id, TokenPurpose.ACTIVATION);
  return { ok: true, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }, activationToken };
}
