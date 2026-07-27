import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor } from '@/lib/auth/permissions';
import { CalendarView, type CalendarEventInput } from '@/components/calendar/calendar-view';

export default async function EigeneKalenderPage() {
  const user = await requireUser();

  const [organization, events] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.event.findMany({
      where: { OR: [{ organizationId: user.homeOrganizationId }, { isSectionWide: true }] },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  const canManage = canManageEventsFor(user, user.homeOrganizationId);

  const calendarEvents: CalendarEventInput[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startsAt.toISOString(),
    end: event.endsAt.toISOString(),
    allDay: event.allDay,
    editable: canManageEventsFor(user, event.organizationId),
    backgroundColor: event.isSectionWide ? '#780000' : undefined,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">
          Termine – {organization.shortName ?? organization.name}
        </h1>
        <div className="flex items-center gap-4 text-sm">
          <a href={`/kalender/ics/${organization.icsToken}`} className="text-brand hover:underline">
            Kalender abonnieren (.ics)
          </a>
          {canManage && (
            <Link href="/kalender/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
              Neuer Termin
            </Link>
          )}
        </div>
      </div>
      <CalendarView events={calendarEvents} />
    </div>
  );
}
