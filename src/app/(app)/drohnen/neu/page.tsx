import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageDroneFlights } from '@/lib/auth/permissions';
import { FlightForm } from '@/components/drone/flight-form';
import { createFlight } from '../actions';

export default async function NeuerFlugPage() {
  const user = await requireUser();

  if (!canManageDroneFlights(user)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, Flüge zu registrieren.</p>;
  }

  const drones = await prisma.drone.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (drones.length === 0) {
    return <p className="text-neutral-700">Es sind noch keine Drohnen hinterlegt. Bitte zuerst in der Verwaltung anlegen.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Flug registrieren</h1>
      <FlightForm drones={drones} action={createFlight} submitLabel="Flug speichern" />
    </div>
  );
}
