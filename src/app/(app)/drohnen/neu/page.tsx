import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canRegisterFlight } from '@/lib/auth/permissions';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { FlightForm } from '@/components/drone/flight-form';
import { createFlight } from '../actions';

export default async function NeuerFlugPage({
  searchParams,
}: {
  searchParams: Promise<{ gruppe?: string }>;
}) {
  const user = await requireUser();

  if (!canRegisterFlight(user)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, Flüge zu registrieren.</p>;
  }

  const params = await searchParams;
  // Gleiches Gruppenwechsel-Muster wie /drohnen (getAllowedDroneGroups) - ein Admin (Bezirksadmin/
  // Bezirks-Drohnenadmin/Abschnittsadmin/Admin Drohnengruppe) kann so auch für eine Gruppe
  // registrieren, in der er selbst kein Mitglied ist (z. B. einen telefonisch gemeldeten Flug
  // nachtragen); ein reines Mitglied ohne Admin-Recht bleibt an die eigene Gruppe gebunden.
  const allowedGroups = await getAllowedDroneGroups(user);
  const isAdmin = allowedGroups.length > 0;

  const selectedGroup = isAdmin
    ? (params.gruppe && allowedGroups.find((g) => g.id === params.gruppe)) || allowedGroups[0]
    : await prisma.droneGroup.findUniqueOrThrow({
        where: { id: user.droneGroupId! },
        select: { id: true, name: true },
      });

  const droneGroupId = selectedGroup.id;
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

  const boundCreateFlight = createFlight.bind(null, droneGroupId);
  // Der Admin selbst ist nicht zwangsläufig Mitglied der gerade gewählten Gruppe (z. B. ein reiner
  // Bezirks-Drohnenadmin ohne eigene Gruppenmitgliedschaft) - "sich selbst" nur vorbelegen, wenn er
  // tatsächlich als Pilot in der Liste steht, sonst bliebe defaultValues.pilotUserId auf eine für
  // diese Gruppe ungültige Id stehen.
  const isSelfEligiblePilot = pilots.some((p) => p.id === user.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Flug registrieren</h1>
      {isAdmin && allowedGroups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {allowedGroups.map((g) => (
            <Link
              key={g.id}
              href={`/drohnen/neu?gruppe=${g.id}`}
              className={`rounded-full px-3.5 py-2 text-sm font-semibold ${g.id === selectedGroup.id ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'}`}
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}
      <FlightForm
        drones={drones}
        pilots={pilots}
        action={boundCreateFlight}
        submitLabel="Flug speichern"
        defaultValues={isSelfEligiblePilot ? { pilotUserId: user.id } : undefined}
      />
    </div>
  );
}
