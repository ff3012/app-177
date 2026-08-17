import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor } from '@/lib/auth/permissions';
import { IncidentForm } from '@/components/incidents/incident-form';
import { createIncident } from '../actions';

export default async function NeuerEinsatzPage() {
  const user = await requireUser();
  if (!canManageIncidentsFor(user, user.homeOrganizationId)) notFound();

  const [fireDepartment, vehicles, crewMembers] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId }, select: { shortName: true, name: true } }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: user.homeOrganizationId, isActive: true },
      orderBy: { lastName: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  const boundCreate = createIncident.bind(null, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Einsatz erfassen</h1>
      <IncidentForm
        fireDepartmentName={fireDepartment.shortName ?? fireDepartment.name}
        vehicleOptions={vehicles}
        crewMemberOptions={crewMembers}
        action={boundCreate}
        submitLabel="Einsatz speichern"
      />
    </div>
  );
}
