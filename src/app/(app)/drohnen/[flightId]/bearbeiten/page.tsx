import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageFlight } from '@/lib/auth/permissions';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { FlightForm } from '@/components/drone/flight-form';
import { toDatetimeLocalValue } from '@/lib/format';
import { deleteFlight, updateFlight } from '../../actions';

export default async function FlugBearbeitenPage({ params }: { params: Promise<{ flightId: string }> }) {
  const user = await requireUser();
  const { flightId } = await params;

  const flight = await prisma.droneFlight.findUnique({ where: { id: flightId }, include: { drone: true } });

  if (!flight) {
    return <p className="text-neutral-700">Flug wurde nicht gefunden.</p>;
  }
  if (!canManageFlight(user, { registeredById: flight.registeredById, droneGroupId: flight.drone.droneGroupId })) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Flug zu bearbeiten.</p>;
  }

  // Dropdown-Optionen bewusst nach der Gruppe DIESES Flugs (über seine Drohne) skaliert, nicht nach
  // user.droneGroupId - deckungsgleich mit updateFlight's eigener Scoping-Logik (siehe actions.ts).
  const droneGroupId = flight.drone.droneGroupId;
  const [drones, pilots] = await Promise.all([
    prisma.drone.findMany({ where: { isActive: true, droneGroupId }, orderBy: { sortOrder: 'asc' } }),
    listDrohnengruppeMembers(droneGroupId),
  ]);

  const boundUpdate = updateFlight.bind(null, flight.id);
  const boundDelete = deleteFlight.bind(null, flight.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Flug bearbeiten</h1>
      <FlightForm
        drones={drones}
        pilots={pilots}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        defaultValues={{
          startsAt: toDatetimeLocalValue(flight.startsAt),
          pilotUserId: flight.pilotUserId,
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
