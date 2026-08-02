'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { vehicleSchema, parseVehicleFormData } from '@/lib/validation/vehicle.schema';
import { atemschutzSchema, parseAtemschutzFormData } from '@/lib/validation/atemschutz.schema';

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
