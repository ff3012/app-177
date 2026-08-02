'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { generateDashboardToken, setDashboardTokenExpiry, revokeDashboardToken } from '@/lib/dashboard/token';

export async function createDashboardToken(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await generateDashboardToken(organizationId, user.id);
  revalidatePath('/admin/heimatfeuerwehr');
}

/** organizationId wird nur zur Berechtigungsprüfung übergeben (der Token selbst trägt seine eigene
 * organizationId in der DB) - ein Admin könnte sonst versuchen, das Ablaufdatum eines fremden Tokens
 * zu setzen, indem er dessen tokenId errät; die Prüfung läuft daher gegen die tatsächlich gespeicherte
 * organizationId des Tokens, nicht gegen das vom Client behauptete organizationId-Argument. */
export async function setTokenExpiry(
  tokenId: string,
  claimedOrganizationId: string,
  _prevState: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, claimedOrganizationId));

  const token = await prisma.dashboardToken.findUnique({ where: { id: tokenId }, select: { organizationId: true } });
  if (!token) {
    return { error: 'Token wurde nicht gefunden.' };
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, token.organizationId));

  const raw = formData.get('expiresAt');
  const expiresAt = typeof raw === 'string' && raw.length > 0 ? new Date(raw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { error: 'Ungültiges Datum.' };
  }

  await setDashboardTokenExpiry(tokenId, expiresAt);
  revalidatePath('/admin/heimatfeuerwehr');
  return {};
}

export async function revokeToken(tokenId: string, claimedOrganizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, claimedOrganizationId));

  const token = await prisma.dashboardToken.findUnique({ where: { id: tokenId }, select: { organizationId: true } });
  if (!token) return;
  assertPermission(canManageHeimatfeuerwehrFor(user, token.organizationId));

  await revokeDashboardToken(tokenId);
  revalidatePath('/admin/heimatfeuerwehr');
}

export interface FacebookConfigState {
  success?: boolean;
  error?: string;
}

/** Leere Eingabe für die Page-ID ist gültig (= "Facebook nicht verbunden" auf dem Dashboard), analog
 * zu setAtemschutzSachbearbeiter's optionalem E-Mail-Feld.
 *
 * Der Access Token wird NIE an den Client zurückgegeben (siehe DashboardFacebookConfigForm -
 * kein defaultValue, nur ein hasAccessToken-Boolean), das Feld startet im Formular deshalb
 * immer leer. Eine leere Übermittlung darf den bestehenden, gespeicherten Token daher NICHT
 * stillschweigend löschen - das wäre sonst bei jedem Speichern der Page-ID der Fall, ohne dass
 * der Admin das Token überhaupt anfassen wollte. Nur zwei Wege ändern den gespeicherten Wert:
 * (1) die "Access Token entfernen"-Checkbox setzt ihn explizit auf null, (2) ein nicht-leerer
 * Wert im Textfeld überschreibt ihn. Ansonsten bleibt data.facebookPageAccessToken schlicht
 * unangetastet (kein Feld im update()-Objekt), statt es unconditionally auf null/'' zu setzen. */
export async function setFacebookConfig(
  organizationId: string,
  _prevState: FacebookConfigState,
  formData: FormData,
): Promise<FacebookConfigState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const pageId = formData.get('facebookPageId');
  const accessToken = formData.get('facebookPageAccessToken');
  const removeAccessToken = Boolean(formData.get('removeAccessToken'));

  const data: { facebookPageId: string | null; facebookPageAccessToken?: string | null } = {
    facebookPageId: typeof pageId === 'string' && pageId.trim() ? pageId.trim() : null,
  };

  if (removeAccessToken) {
    data.facebookPageAccessToken = null;
  } else if (typeof accessToken === 'string' && accessToken.trim()) {
    data.facebookPageAccessToken = accessToken.trim();
  }
  // Sonst: Feld weder in `data` noch sonst wo gesetzt - der gespeicherte Wert bleibt unverändert.

  await prisma.organization.update({
    where: { id: organizationId },
    data,
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}
