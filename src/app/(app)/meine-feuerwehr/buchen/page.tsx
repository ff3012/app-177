import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { createVehicleBooking } from '../actions';
import { BookingForm } from './booking-form';

export default async function FahrzeugBuchenPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string }>;
}) {
  const user = await requireUser();
  const { vehicleId } = await searchParams;

  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId: user.homeOrganizationId, isActive: true },
    orderBy: { taktischeBezeichnung: 'asc' },
    select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
  });

  const initialVehicleId = vehicleId && vehicles.some((v) => v.id === vehicleId) ? vehicleId : undefined;

  // "Fahrzeugreservierung für"-Auswahl nur für Admins der eigenen Heimatfeuerwehr - siehe
  // docs/superpowers/specs/2026-08-28-fahrzeugreservierung-admin-stellvertretend-design.md.
  const isAdmin = canManageHeimatfeuerwehrFor(user, user.homeOrganizationId);
  const bookingForMembers = isAdmin
    ? await prisma.user.findMany({
        where: { homeOrganizationId: user.homeOrganizationId, ...NOT_DEACTIVATED_WHERE },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true },
      })
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Fahrzeug Reservierungen</h1>
      {vehicles.length === 0 ? (
        <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
      ) : (
        <BookingForm
          vehicles={vehicles}
          action={createVehicleBooking}
          initialVehicleId={initialVehicleId}
          bookingForMembers={bookingForMembers}
          currentUserId={isAdmin ? user.id : undefined}
          currentUserName={isAdmin ? user.name : undefined}
        />
      )}
    </div>
  );
}
