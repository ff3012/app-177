import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor, canViewDroneModule } from '@/lib/auth/permissions';
import { KalenderWithLayers, type CalendarLayer, type IcsLink } from '@/components/calendar/kalender-with-layers';
import type { CalendarEventInput } from '@/components/calendar/calendar-view';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

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

  const eventIds = allEvents.map((event) => event.id);
  const [rsvpGroups, ownRsvps] = await Promise.all([
    eventIds.length > 0
      ? prisma.terminZusage.groupBy({ by: ['eventId', 'status'], where: { eventId: { in: eventIds } }, _count: true })
      : Promise.resolve([]),
    eventIds.length > 0
      ? prisma.terminZusage.findMany({
          where: { eventId: { in: eventIds }, userId: user.id },
          select: { eventId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const rsvpCountsByEvent = new Map<string, { ZUGESAGT: number; ABGESAGT: number; UNKLAR: number }>();
  for (const group of rsvpGroups) {
    const counts = rsvpCountsByEvent.get(group.eventId) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 };
    counts[group.status] = group._count;
    rsvpCountsByEvent.set(group.eventId, counts);
  }
  const myRsvpByEvent = new Map(ownRsvps.map((rsvp) => [rsvp.eventId, rsvp.status]));

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
        backgroundColor: LAYER_COLORS[layer],
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
        myRsvpStatus: myRsvpByEvent.get(event.id) ?? null,
        rsvpCounts: rsvpCountsByEvent.get(event.id) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 },
      };
    });

  const combinedIcsToken = process.env.ABSCHNITTS_ICS_TOKEN;

  const icsLinks: IcsLink[] = [
    {
      label: 'Kalender abonnieren (.ics)',
      href: `/kalender/ics/${organization.icsToken}`,
      copyText: `${baseUrl()}/kalender/ics/${organization.icsToken}`,
    },
  ];
  if (combinedIcsToken) {
    icsLinks.push({
      label: 'Abschnitt-Kalender abonnieren (.ics)',
      href: `/kalender/ics/${combinedIcsToken}`,
      copyText: `${baseUrl()}/kalender/ics/${combinedIcsToken}`,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">
          Kalender – {organization.shortName ?? organization.name}
        </h1>
        {canCreateAnyEvent && (
          <Link href="/kalender/neu" className="self-start rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark sm:self-auto">
            Neuer Termin
          </Link>
        )}
      </div>
      <KalenderWithLayers events={calendarEvents} layers={layers} icsLinks={icsLinks} />
    </div>
  );
}
