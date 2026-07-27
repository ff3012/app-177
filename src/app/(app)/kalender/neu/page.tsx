import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateSectionWideEvent } from '@/lib/auth/permissions';
import { EventForm } from '@/components/calendar/event-form';
import { createEvent } from '../actions';

export default async function NeuerTerminPage({
  searchParams,
}: {
  searchParams: Promise<{ sectionWide?: string }>;
}) {
  const user = await requireUser();

  if (user.feuerwehrAdminOrgIds.length === 0) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, Termine anzulegen.</p>;
  }

  const { sectionWide } = await searchParams;
  const canSectionWide = canCreateSectionWideEvent(user);

  const organizations = await prisma.organization.findMany({
    where: { id: { in: user.feuerwehrAdminOrgIds } },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neuer Termin</h1>
      <EventForm
        organizations={organizations}
        canSectionWide={canSectionWide}
        action={createEvent}
        submitLabel="Termin anlegen"
        defaultValues={canSectionWide && sectionWide === '1' ? { isSectionWide: true } : undefined}
      />
    </div>
  );
}
