import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor } from '@/lib/auth/permissions';
import { CalendarView, type CalendarEventInput } from '@/components/calendar/calendar-view';

export default async function AbschnittKalenderPage() {
  const user = await requireUser();

  const events = await prisma.event.findMany({
    include: { organization: true },
    orderBy: { startsAt: 'asc' },
  });

  const calendarEvents: CalendarEventInput[] = events.map((event) => ({
    id: event.id,
    title: event.isSectionWide ? event.title : `${event.organization.shortName ?? event.organization.name}: ${event.title}`,
    start: event.startsAt.toISOString(),
    end: event.endsAt.toISOString(),
    allDay: event.allDay,
    editable: canManageEventsFor(user, event.organizationId),
    backgroundColor: event.isSectionWide ? '#780000' : undefined,
  }));

  const combinedIcsToken = process.env.ABSCHNITTS_ICS_TOKEN;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Abschnitt-Kalender (alle Feuerwehren)</h1>
        <div className="flex items-center gap-4 text-sm">
          {combinedIcsToken && (
            <a href={`/kalender/ics/${combinedIcsToken}`} className="text-brand hover:underline">
              Gesamten Kalender abonnieren (.ics)
            </a>
          )}
          <Link href="/kalender" className="text-neutral-600 hover:underline">
            Zurück zu meiner Feuerwehr
          </Link>
        </div>
      </div>
      <CalendarView events={calendarEvents} />
    </div>
  );
}
