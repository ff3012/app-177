'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { vehicleSchema, parseVehicleFormData } from '@/lib/validation/vehicle.schema';
import { atemschutzSchema, parseAtemschutzFormData } from '@/lib/validation/atemschutz.schema';
import { syncIcsCalendarForOrganization } from '@/lib/calendar/ics-import';

export interface VehicleFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function createVehicle(
  organizationId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = vehicleSchema.safeParse(parseVehicleFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existing = await prisma.vehicle.findUnique({ where: { kennzeichen: data.kennzeichen } });
  if (existing) {
    return { fieldErrors: { kennzeichen: ['Ein Fahrzeug mit diesem Kennzeichen existiert bereits.'] } };
  }

  await prisma.vehicle.create({ data: { ...data, organizationId } });
  revalidatePath('/admin/heimatfeuerwehr');
  return {};
}

export async function updateVehicle(
  vehicleId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const user = await requireUser();

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) {
    return { error: 'Fahrzeug wurde nicht gefunden.' };
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, vehicle.organizationId));

  const parsed = vehicleSchema.safeParse(parseVehicleFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existing = await prisma.vehicle.findUnique({ where: { kennzeichen: data.kennzeichen } });
  if (existing && existing.id !== vehicleId) {
    return { fieldErrors: { kennzeichen: ['Ein Fahrzeug mit diesem Kennzeichen existiert bereits.'] } };
  }

  await prisma.vehicle.update({ where: { id: vehicleId }, data });
  revalidatePath('/admin/heimatfeuerwehr');
  return {};
}

export async function toggleVehicleActive(vehicleId: string): Promise<void> {
  const user = await requireUser();

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return;
  assertPermission(canManageHeimatfeuerwehrFor(user, vehicle.organizationId));

  await prisma.vehicle.update({ where: { id: vehicleId }, data: { isActive: !vehicle.isActive } });
  revalidatePath('/admin/heimatfeuerwehr');
}

export interface DeleteVehicleState {
  error?: string;
}

/** Blockiert bei jeder vorhandenen Buchung (auch vergangenen), um die Buchungshistorie/
 * Auslastungsübersicht (fahrzeug/[vehicleId]/page.tsx) zu schützen - ein proaktiver Zähl-Check
 * statt einen FK-Constraint-Fehler aufzufangen, da Vehicle→VehicleBooking eine simple
 * 1:n-Beziehung ist und das eine garantiert freundliche Meldung liefert. Ein Fahrzeug mit
 * Buchungen kann stattdessen nur deaktiviert werden. */
export async function deleteVehicle(vehicleId: string): Promise<DeleteVehicleState> {
  const user = await requireUser();

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) {
    return {};
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, vehicle.organizationId));

  const bookingCount = await prisma.vehicleBooking.count({ where: { vehicleId } });
  if (bookingCount > 0) {
    return {
      error: `Dieses Fahrzeug hat ${bookingCount} Buchung${bookingCount === 1 ? '' : 'en'} und kann nicht gelöscht werden - stattdessen deaktivieren.`,
    };
  }

  await prisma.vehicle.delete({ where: { id: vehicleId } });
  revalidatePath('/admin/heimatfeuerwehr');
  return {};
}

export interface AtemschutzFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function updateAtemschutzStatus(
  userId: string,
  _prevState: AtemschutzFormState,
  formData: FormData,
): Promise<AtemschutzFormState> {
  const user = await requireUser();

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { homeOrganizationId: true } });
  if (!target) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, target.homeOrganizationId));

  const parsed = atemschutzSchema.safeParse(parseAtemschutzFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  await prisma.user.update({
    where: { id: userId },
    data: {
      atemschutzUntersuchungAm: data.atemschutzUntersuchungAm ? new Date(data.atemschutzUntersuchungAm) : null,
      atemschutzGueltigBis: data.atemschutzGueltigBis ? new Date(data.atemschutzGueltigBis) : null,
      atemschutzFinnentestAm: data.atemschutzFinnentestAm ? new Date(data.atemschutzFinnentestAm) : null,
    },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return {};
}

export interface AtemschutzSachbearbeiterState {
  success?: boolean;
  error?: string;
}

const sachbearbeiterEmailSchema = z.union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse.')]);

/** Leere Eingabe ist gültig (= keine tägliche Warn-E-Mail für diese Feuerwehr), anders als die
 * verpflichtenden Empfänger-Felder auf /admin/email. */
export async function setAtemschutzSachbearbeiter(
  organizationId: string,
  _prevState: AtemschutzSachbearbeiterState,
  formData: FormData,
): Promise<AtemschutzSachbearbeiterState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = sachbearbeiterEmailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse.' };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { atemschutzSachbearbeiterEmail: parsed.data || null },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}

export interface WappenUploadState {
  error?: string;
  success?: boolean;
}

const MAX_WAPPEN_SIZE_BYTES = 2 * 1024 * 1024;

/** Wappen-Bild für die mobile Tab-Bar/Startbildschirm (Startbildschirm-Brief.md §3) - Bytes in
 * Postgres, analog zum PDF-Upload in admin/drohnen/actions.ts (uploadDroneDocument). */
export async function setOrganizationWappen(
  organizationId: string,
  _prevState: WappenUploadState,
  formData: FormData,
): Promise<WappenUploadState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Bilddatei auswählen.' };
  }
  if (!file.type.startsWith('image/')) {
    return { error: 'Nur Bilddateien sind erlaubt.' };
  }
  if (file.size > MAX_WAPPEN_SIZE_BYTES) {
    return { error: 'Die Datei ist zu groß (maximal 2 MB).' };
  }

  const data = Buffer.from(await file.arrayBuffer());
  await prisma.organization.update({
    where: { id: organizationId },
    data: { wappenImageData: data, wappenImageMimeType: file.type },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/meine-feuerwehr');
  return { success: true };
}

export async function removeOrganizationWappen(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await prisma.organization.update({
    where: { id: organizationId },
    data: { wappenImageData: null, wappenImageMimeType: null },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/meine-feuerwehr');
}

export interface FahrzeugReservierungEmailState {
  success?: boolean;
  error?: string;
}

const fahrzeugReservierungEmailSchema = z.union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse.')]);

/** Leere Eingabe ist gültig (= keine Freigabe nötig, neue Reservierungen werden sofort genehmigt -
 * siehe createVehicleBooking). Gleiches Muster wie setAtemschutzSachbearbeiter. */
export async function setFahrzeugReservierungEmail(
  organizationId: string,
  _prevState: FahrzeugReservierungEmailState,
  formData: FormData,
): Promise<FahrzeugReservierungEmailState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = fahrzeugReservierungEmailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse.' };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { fahrzeugReservierungEmail: parsed.data || null },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}

export interface IcsImportUrlState {
  success?: boolean;
  error?: string;
}

const icsImportUrlSchema = z.union([
  z.literal(''),
  z.string().trim().url('Ungültige URL.').refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'Die URL muss mit http:// oder https:// beginnen.',
  }),
]);

/** Leere Eingabe ist gültig (= kein ICS-Import für diese Feuerwehr). Öffentliche .ics-Feeds
 * (z. B. ein Google-Kalender-Freigabelink) enthalten kein Geheimnis, daher anders als
 * facebookPageAccessToken keine Maskierung/"leer lassen = unverändert"-Logik nötig - die
 * tatsächliche URL wird im Formular immer im Klartext angezeigt. */
export async function setIcsImportUrl(
  organizationId: string,
  _prevState: IcsImportUrlState,
  formData: FormData,
): Promise<IcsImportUrlState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = icsImportUrlSchema.safeParse(formData.get('icsImportUrl'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige URL.' };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      icsImportUrl: parsed.data || null,
      // Ein Adresswechsel macht den letzten Fehler/Sync-Zeitpunkt der ALTEN Quelle bedeutungslos -
      // sonst würde "Zuletzt synchronisiert" nach dem Ändern der URL fälschlich einen alten,
      // erfolgreichen Sync-Zeitpunkt der vorherigen Quelle zeigen.
      icsImportLastSyncAt: null,
      icsImportLastSyncError: null,
    },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}

export interface IcsImportTriggerState {
  success?: boolean;
  error?: string;
  imported?: number;
  updated?: number;
  removed?: number;
}

/** "Jetzt synchronisieren" - ruft exakt dieselbe Sync-Funktion wie der 5-Minuten-Cron
 * (api/cron/kalender-ics-sync) auf, für einen sofortigen End-zu-Ende-Test nach dem Setzen der
 * URL, statt auf den nächsten Cron-Lauf warten zu müssen (gleiches Prinzip wie der manuelle
 * "System Check"-Button auf /admin/status, der dieselbe Funktion wie der tägliche Cron aufruft). */
export async function triggerIcsImportNow(organizationId: string): Promise<IcsImportTriggerState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { icsImportUrl: true },
  });
  if (!organization?.icsImportUrl) {
    return { error: 'Keine ICS-Kalender-URL hinterlegt.' };
  }

  try {
    const result = await syncIcsCalendarForOrganization(organizationId, organization.icsImportUrl);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { icsImportLastSyncAt: new Date(), icsImportLastSyncError: null },
    });
    revalidatePath('/admin/heimatfeuerwehr');
    revalidatePath('/kalender');
    return { success: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler beim Synchronisieren.';
    await prisma.organization.update({
      where: { id: organizationId },
      data: { icsImportLastSyncAt: new Date(), icsImportLastSyncError: message },
    });
    revalidatePath('/admin/heimatfeuerwehr');
    return { error: message };
  }
}
