import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor } from '@/lib/auth/permissions';
import { IncidentForm } from '@/components/incidents/incident-form';
import { updateIncident } from '../../actions';

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EinsatzBearbeitenPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const user = await requireUser();

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      fireDepartment: { select: { shortName: true, name: true } },
      vehicles: { select: { vehicleId: true } },
      crewMembers: { select: { userId: true } },
    },
  });
  if (!incident || !canManageIncidentsFor(user, incident.fireDepartmentId)) notFound();

  const [vehicles, crewMembers] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: incident.fireDepartmentId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: incident.fireDepartmentId, isActive: true },
      orderBy: { lastName: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  const boundUpdate = updateIncident.bind(null, incident.id);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Einsatz bearbeiten</h1>
      <IncidentForm
        fireDepartmentName={incident.fireDepartment.shortName ?? incident.fireDepartment.name}
        vehicleOptions={vehicles}
        crewMemberOptions={crewMembers}
        defaultValues={{
          kind: incident.kind,
          keyword: incident.keyword,
          location: incident.location,
          alarmedAt: toLocalInputValue(incident.alarmedAt),
          endedAt: incident.endedAt ? toLocalInputValue(incident.endedAt) : '',
          crewCount: incident.crewCount != null ? String(incident.crewCount) : '',
          vehicleIds: incident.vehicles.map((v) => v.vehicleId),
          crewMemberIds: incident.crewMembers.map((c) => c.userId),
        }}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
      />
    </div>
  );
}
