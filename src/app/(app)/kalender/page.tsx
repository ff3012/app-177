import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor, canViewDroneModule } from '@/lib/auth/permissions';
import { KalenderWithLayers, type CalendarLayer } from '@/components/calendar/kalender-with-layers';
import type { CalendarEventInput } from '@/components/calendar/calendar-view';

export default async function KalenderPage() {
  const user = await requireUser();

  const [organization, allEvents] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.event.findMany({
      where: { OR: [{ organizationId: user.homeOrganizationId }, { isSectionWide: true }] },
      include: { organization: true },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  const canSeeDroneCategory = canViewDroneModule(user);
  const canCreateAnyEvent = user.feuerwehrAdminOrgIds.length > 0;

  const layers: CalendarLayer[] = [
    { key: 'own', label: 'Meine Feuerwehr' },
    { key: 'abschnitt', label: 'Abschnitt-Kalender' },
  ];
  if (canSeeDroneCategory) {
    layers.push({ key: 'drohnengruppe', label: 'Drohnengruppe' });
  }

  const calendarEvents: CalendarEventInput[] = allEvents
    .filter((event) => event.category !== 'DROHNENGRUPPE' || canSeeDroneCategory)
    .map((event) => {
      const layer = event.category === 'DROHNENGRUPPE' ? 'drohnengruppe' : event.isSectionWide ? 'abschnitt' : 'own';
      return {
        id: event.id,
        title: event.title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        allDay: event.allDay,
        editable: canManageEventsFor(user, event.organizationId),
        backgroundColor: layer === 'drohnengruppe' ? '#15803d' : layer === 'abschnitt' ? '#c62828' : undefined,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
      };
    });

  const combinedIcsToken = process.env.ABSCHNITTS_ICS_TOKEN;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">
          Kalender – {organization.shortName ?? organization.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
          <a href={`/kalender/ics/${organization.icsToken}`} className="text-brand hover:underline">
            Kalender abonnieren (.ics)
          </a>
          {combinedIcsToken && (
            <a href={`/kalender/ics/${combinedIcsToken}`} className="text-brand hover:underline">
              Abschnitt-Kalender abonnieren (.ics)
            </a>
          )}
          {canCreateAnyEvent && (
            <Link href="/kalender/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
              Neuer Termin
            </Link>
          )}
        </div>
      </div>
      <KalenderWithLayers events={calendarEvents} layers={layers} />
    </div>
  );
}
