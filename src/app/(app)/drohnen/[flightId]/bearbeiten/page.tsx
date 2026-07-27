import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageDroneFlights } from '@/lib/auth/permissions';
import { FlightForm } from '@/components/drone/flight-form';
import { toDatetimeLocalValue } from '@/lib/format';
import { deleteFlight, updateFlight } from '../../actions';

export default async function FlugBearbeitenPage({ params }: { params: Promise<{ flightId: string }> }) {
  const user = await requireUser();
  const { flightId } = await params;

  if (!canManageDroneFlights(user)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Flug zu bearbeiten.</p>;
  }

  const [flight, drones] = await Promise.all([
    prisma.droneFlight.findUnique({ where: { id: flightId } }),
    prisma.drone.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);

  if (!flight) {
    return <p className="text-neutral-700">Flug wurde nicht gefunden.</p>;
  }

  const boundUpdate = updateFlight.bind(null, flight.id);
  const boundDelete = deleteFlight.bind(null, flight.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Flug bearbeiten</h1>
      <FlightForm
        drones={drones}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        defaultValues={{
          startsAt: toDatetimeLocalValue(flight.startsAt),
          pilotName: flight.pilotName,
          location: flight.location,
          droneId: flight.droneId,
          purpose: flight.purpose,
          notes: flight.notes ?? '',
        }}
      />
      <form action={boundDelete}>
        <button type="submit" className="text-sm text-red-700 hover:underline">
          Flug löschen
        </button>
      </form>
    </div>
  );
}
