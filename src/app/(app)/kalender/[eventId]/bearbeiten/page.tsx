import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateSectionWideEvent, canManageEventsFor } from '@/lib/auth/permissions';
import { EventForm } from '@/components/calendar/event-form';
import { toDatetimeLocalValue } from '@/lib/format';
import { deleteEvent, updateEvent } from '../../actions';

export default async function TerminBearbeitenPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireUser();
  const { eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return <p className="text-neutral-700">Termin wurde nicht gefunden.</p>;
  }
  if (!canManageEventsFor(user, event.organizationId)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Termin zu bearbeiten.</p>;
  }

  const organizations = await prisma.organization.findMany({
    where: { id: { in: user.feuerwehrAdminOrgIds } },
    orderBy: { name: 'asc' },
  });

  const boundUpdate = updateEvent.bind(null, event.id);
  const boundDelete = deleteEvent.bind(null, event.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
      <EventForm
        organizations={organizations}
        canSectionWide={canCreateSectionWideEvent(user)}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        defaultValues={{
          title: event.title,
          description: event.description ?? '',
          location: event.location ?? '',
          startsAt: toDatetimeLocalValue(event.startsAt),
          endsAt: toDatetimeLocalValue(event.endsAt),
          allDay: event.allDay,
          organizationId: event.organizationId,
          isSectionWide: event.isSectionWide,
          category: event.category,
        }}
      />
      <form action={boundDelete}>
        <button type="submit" className="text-sm text-red-700 hover:underline">
          Termin löschen
        </button>
      </form>
    </div>
  );
}
