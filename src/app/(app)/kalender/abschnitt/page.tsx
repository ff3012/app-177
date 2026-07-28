import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateSectionWideEvent, canManageEventsFor, canViewDroneModule } from '@/lib/auth/permissions';
import { CalendarView, type CalendarEventInput } from '@/components/calendar/calendar-view';

export default async function AbschnittKalenderPage() {
  const user = await requireUser();

  const allEvents = await prisma.event.findMany({
    where: { isSectionWide: true },
    include: { organization: true },
    orderBy: { startsAt: 'asc' },
  });

  // Kategorie "Drohnengruppe" ist nur für Mitglieder/Admins der Drohnengruppe sichtbar.
  const canSeeDroneCategory = canViewDroneModule(user);
  const events = allEvents.filter((event) => event.category !== 'DROHNENGRUPPE' || canSeeDroneCategory);

  const calendarEvents: CalendarEventInput[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startsAt.toISOString(),
    end: event.endsAt.toISOString(),
    allDay: event.allDay,
    editable: canManageEventsFor(user, event.organizationId),
    backgroundColor: event.category === 'DROHNENGRUPPE' ? '#1d4ed8' : '#780000',
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    organizationName: event.organization.shortName ?? event.organization.name,
  }));

  const combinedIcsToken = process.env.ABSCHNITTS_ICS_TOKEN;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Abschnitt-Kalender (Abschnitt-weite Termine)</h1>
        <div className="flex items-center gap-4 text-sm">
          {combinedIcsToken && (
            <a href={`/kalender/ics/${combinedIcsToken}`} className="text-brand hover:underline">
              Abschnitt-Kalender abonnieren (.ics)
            </a>
          )}
          <Link href="/kalender" className="text-neutral-600 hover:underline">
            Zurück zu meiner Feuerwehr
          </Link>
          {canCreateSectionWideEvent(user) && (
            <Link
              href="/kalender/neu?sectionWide=1"
              className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark"
            >
              Neuer Termin
            </Link>
          )}
        </div>
      </div>
      <CalendarView events={calendarEvents} />
    </div>
  );
}
