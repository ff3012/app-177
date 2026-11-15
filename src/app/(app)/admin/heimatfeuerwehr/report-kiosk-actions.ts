'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { clearReportKioskToken, setReportKioskToken } from '@/lib/heimatfeuerwehr/report-kiosk-token';

/** Erzeugt den Link der iPad-Schnellerfassung oder dreht ihn neu (der alte Link ist sofort ungültig). */
export async function createReportKioskLink(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await setReportKioskToken(organizationId);
  revalidatePath('/admin/heimatfeuerwehr');
}

/** Schaltet die Schnellerfassung ab: der bisherige Link antwortet 404. */
export async function disableReportKioskLink(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await clearReportKioskToken(organizationId);
  revalidatePath('/admin/heimatfeuerwehr');
}
