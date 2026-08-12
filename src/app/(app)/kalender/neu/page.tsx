import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateAnySectionWideEvent, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { EventForm } from '@/components/calendar/event-form';
import { createEvent } from '../actions';

export default async function NeuerTerminPage({
  searchParams,
}: {
  searchParams: Promise<{ sectionWide?: string }>;
}) {
  const user = await requireUser();

  // Erweitert gegenüber vorher (nur feuerwehrAdminOrgIds.length > 0): ein reiner Admin Drohnengruppe
  // oder ein reiner Bezirksadmin/Bezirks-Drohnenadmin ohne eigene Feuerwehr-Admin-Mitgliedschaft muss
  // diese Seite ebenfalls erreichen können, um einen Drohnengruppen- bzw. bezirksweiten Termin
  // anzulegen (siehe Design-Spec Requirement 3). Ein plain Feuerwehr-Admin bleibt unverändert erlaubt.
  const canReachPage =
    user.feuerwehrAdminOrgIds.length > 0 || isDroneGroupAdmin(user) || isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
  if (!canReachPage) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, Termine anzulegen.</p>;
  }

  const { sectionWide } = await searchParams;
  const canSectionWide = canCreateAnySectionWideEvent(user);

  const [organizations, droneGroupOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds }, isActive: true },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neuer Termin</h1>
      <EventForm
        organizations={organizations}
        canSectionWide={canSectionWide}
        droneGroupOptions={droneGroupOptions}
        action={createEvent}
        submitLabel="Termin anlegen"
        defaultValues={canSectionWide && sectionWide === '1' ? { isSectionWide: true } : undefined}
      />
    </div>
  );
}
