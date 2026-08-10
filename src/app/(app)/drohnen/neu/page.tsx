import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canRegisterFlight } from '@/lib/auth/permissions';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { FlightForm } from '@/components/drone/flight-form';
import { createFlight } from '../actions';

export default async function NeuerFlugPage() {
  const user = await requireUser();

  if (!canRegisterFlight(user)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, Flüge zu registrieren.</p>;
  }

  const droneGroupId = user.droneGroupId!;
  const [drones, pilots] = await Promise.all([
    prisma.drone.findMany({ where: { isActive: true, droneGroupId }, orderBy: { sortOrder: 'asc' } }),
    listDrohnengruppeMembers(droneGroupId),
  ]);

  if (drones.length === 0) {
    return <p className="text-neutral-700">Es sind noch keine Drohnen hinterlegt. Bitte zuerst in der Verwaltung anlegen.</p>;
  }
  if (pilots.length === 0) {
    return <p className="text-neutral-700">Es sind noch keine Mitglieder der Drohnengruppe hinterlegt.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Flug registrieren</h1>
      <FlightForm
        drones={drones}
        pilots={pilots}
        action={createFlight}
        submitLabel="Flug speichern"
        defaultValues={{ pilotUserId: user.id }}
      />
    </div>
  );
}
