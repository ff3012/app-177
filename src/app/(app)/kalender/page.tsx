import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor, canViewDroneModule } from '@/lib/auth/permissions';
import { CalendarView, type CalendarEventInput } from '@/components/calendar/calendar-view';

export default async function EigeneKalenderPage() {
  const user = await requireUser();

  const [organization, allEvents] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.event.findMany({
      where: { OR: [{ organizationId: user.homeOrganizationId }, { isSectionWide: true }] },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  // Kategorie "Drohnengruppe" ist nur für Mitglieder/Admins der Drohnengruppe sichtbar.
  const canSeeDroneCategory = canViewDroneModule(user);
  const events = allEvents.filter((event) => event.category !== 'DROHNENGRUPPE' || canSeeDroneCategory);

  const canManage = canManageEventsFor(user, user.homeOrganizationId);

  const calendarEvents: CalendarEventInput[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startsAt.toISOString(),
    end: event.endsAt.toISOString(),
    allDay: event.allDay,
    editable: canManageEventsFor(user, event.organizationId),
    backgroundColor: event.category === 'DROHNENGRUPPE' ? '#1d4ed8' : event.isSectionWide ? '#780000' : undefined,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">
          Termine – {organization.shortName ?? organization.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
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
