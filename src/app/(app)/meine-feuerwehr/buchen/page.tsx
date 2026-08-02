import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Fahrzeug ausborgen</h1>
      {vehicles.length === 0 ? (
        <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
      ) : (
        <BookingForm vehicles={vehicles} action={createVehicleBooking} initialVehicleId={initialVehicleId} />
      )}
    </div>
  );
}
