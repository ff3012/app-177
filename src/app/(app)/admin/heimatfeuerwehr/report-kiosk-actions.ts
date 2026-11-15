'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { clearReportKioskToken, setReportKioskToken } from '@/lib/heimatfeuerwehr/report-kiosk-token';
import { parseDeviceName, saveReportKioskDeviceName } from '@/lib/heimatfeuerwehr/report-kiosk-device-name';

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

export interface DeviceNameState {
  success?: boolean;
  error?: string;
}

/** Gerätename des iPads (Anzeige im Kopf der Schnellerfassung); leer entfernt den Namen. */
export async function setReportKioskDeviceName(
  organizationId: string,
  _prevState: DeviceNameState,
  formData: FormData,
): Promise<DeviceNameState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = parseDeviceName(formData.get('deviceName'));
  if (!parsed.ok) return { error: parsed.error };

  try {
    await saveReportKioskDeviceName(organizationId, parsed.value);
  } catch {
    return { error: 'Die Schnellerfassung gibt es nur für aktive Feuerwehren.' };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}
