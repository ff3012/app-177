'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageVehicleBooking } from '@/lib/auth/permissions';
import { vehicleBookingSchema, parseVehicleBookingFormData } from '@/lib/validation/vehicle-booking.schema';
import { findOverlappingBooking } from '@/lib/heimatfeuerwehr/vehicle-availability';

export interface VehicleBookingFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function createVehicleBooking(
  _prevState: VehicleBookingFormState,
  formData: FormData,
): Promise<VehicleBookingFormState> {
  const user = await requireUser();

  const parsed = vehicleBookingSchema.safeParse(parseVehicleBookingFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle || !vehicle.isActive || vehicle.organizationId !== user.homeOrganizationId) {
    return { fieldErrors: { vehicleId: ['Ausgewähltes Fahrzeug ist nicht verfügbar.'] } };
  }

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  const overlap = await findOverlappingBooking(data.vehicleId, startsAt, endsAt);
  if (overlap) {
    return {
      error: `Das Fahrzeug ist in diesem Zeitraum bereits von ${overlap.user.firstName} ${overlap.user.lastName} gebucht.`,
    };
  }

  await prisma.vehicleBooking.create({
    data: { vehicleId: data.vehicleId, userId: user.id, startsAt, endsAt },
  });

  revalidatePath('/meine-feuerwehr');
  redirect('/meine-feuerwehr');
}

export async function cancelVehicleBooking(bookingId: string): Promise<void> {
  const user = await requireUser();

  const booking = await prisma.vehicleBooking.findUnique({
    where: { id: bookingId },
    include: { vehicle: { select: { organizationId: true } } },
  });
  if (!booking) {
    redirect('/meine-feuerwehr');
  }
  assertPermission(canManageVehicleBooking(user, booking, booking.vehicle.organizationId));

  await prisma.vehicleBooking.delete({ where: { id: bookingId } });
  revalidatePath('/meine-feuerwehr');
  redirect('/meine-feuerwehr');
}
