import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEvent, canViewDroneModule, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';
import { KalenderWithLayersOnline } from '@/components/calendar/kalender-with-layers-online';
import type { CalendarLayer } from '@/components/calendar/kalender-with-layers';
import type { CalendarEventInput } from '@/components/calendar/calendar-view';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';
import { CollapsingPageTitle } from '@/components/layout/collapsing-page-title';

export default async function KalenderPage() {
  const user = await requireUser();
  // Vorab berechnet (statt wie vorher erst nach der Event-Query), weil die Query selbst jetzt eine
  // dritte, drohnengruppen-eigene OR-Bedingung braucht - ohne die würde ein bezirksweiter oder ein
  // Termin einer fremden (Abschnitt-)Feuerwehr innerhalb der eigenen Drohnengruppe gar nicht erst aus
  // der DB geladen, unabhängig vom späteren .filter().
  const canSeeDroneCategory = canViewDroneModule(user);

  const [organization, allEvents, droneGroups, sondergruppen, currentUser] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
          // Bezirk-weite ALLGEMEIN-Termine sind für jeden im Bezirk sichtbar, unabhängig von
          // Organisation/Abschnitt (siehe canViewEvent, docs/superpowers/specs/
          // 2026-09-01-kalender-sondergruppen-design.md).
          { category: 'ALLGEMEIN' as const, isDistrictWide: true },
          // Drohnengruppen-Termine sind komplett unabhängig von Organisation/Abschnitt sichtbar (siehe
          // canViewEvent) - eigene Gruppe ODER bezirksweit (droneGroupId null), unabhängig davon, bei
          // welcher Feuerwehr/Abschnitt das Event technisch "organizationId" trägt.
          ...(canSeeDroneCategory
            ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }]
            : []),
        ],
      },
      include: { organization: true },
      orderBy: { startsAt: 'asc' },
    }),
    // Nur für die editable-Berechnung unten gebraucht (canManageEvent braucht die organizationId der
    // JEWEILIGEN Gruppe eines Events, nicht die des Events selbst - bei bezirksweiten Terminen weichen
    // die ab). Wird nur geladen, wenn überhaupt Drohnengruppen-Termine sichtbar sein können.
    canSeeDroneCategory
      ? prisma.droneGroup.findMany({ select: { id: true, organizationId: true } })
      : Promise.resolve([]),
    prisma.sondergruppe.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { ausgeblendeteSondergruppenIds: true },
    }),
  ]);

  const droneGroupsById = new Map(droneGroups.map((group) => [group.id, group]));

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

  // Erweitert gegenüber vorher (nur feuerwehrAdminOrgIds.length > 0), analog zur Zugriffsprüfung in
  // kalender/neu/page.tsx: ein reiner Admin Drohnengruppe oder ein reiner Bezirksadmin/Bezirks-
  // Drohnenadmin ohne eigene Feuerwehr-Admin-Mitgliedschaft muss den "Neuer Termin"-Button ebenfalls
  // sehen. Ein plain Feuerwehr-Admin bleibt unverändert erlaubt.
  const canCreateAnyEvent =
    user.feuerwehrAdminOrgIds.length > 0 || isDroneGroupAdmin(user) || isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;

  const layers: CalendarLayer[] = [
    { key: 'own', label: 'Meine Feuerwehr' },
    { key: 'abschnitt', label: 'Abschnitt-Kalender' },
    { key: 'bezirk', label: 'Bezirk-weit' },
  ];
  if (canSeeDroneCategory) {
    layers.push({ key: 'drohnengruppe', label: 'Drohnengruppe' });
  }

  const calendarEvents: CalendarEventInput[] = allEvents
    .filter(
      (event) =>
        event.category !== 'DROHNENGRUPPE' ||
        (canSeeDroneCategory && (event.droneGroupId === null || event.droneGroupId === user.droneGroupId)),
    )
    .map((event) => {
      const layer =
        event.category === 'DROHNENGRUPPE'
          ? 'drohnengruppe'
          : event.isDistrictWide
            ? 'bezirk'
            : event.isSectionWide
              ? 'abschnitt'
              : 'own';
      const droneGroup = event.droneGroupId ? droneGroupsById.get(event.droneGroupId) ?? null : null;
      return {
        id: event.id,
        title: event.title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        allDay: event.allDay,
        editable: canManageEvent(user, event, droneGroup) && !event.vehicleBookingId && !event.icsUid,
        backgroundColor: LAYER_COLORS[layer],
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
        myRsvpStatus: myRsvpByEvent.get(event.id) ?? null,
        rsvpCounts: rsvpCountsByEvent.get(event.id) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 },
        isVehicleBooking: event.vehicleBookingId !== null,
        isDistrictWideDrone: event.category === 'DROHNENGRUPPE' && event.droneGroupId === null,
        sondergruppeId: event.sondergruppeId,
      };
    });

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CollapsingPageTitle title={`Kalender – ${organization.shortName ?? organization.name}`} />
        {canCreateAnyEvent && (
          <Link href="/kalender/neu" className="self-start rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark sm:self-auto">
            Neuer Termin
          </Link>
        )}
      </div>
      <KalenderWithLayersOnline
        events={calendarEvents}
        layers={layers}
        sondergruppen={sondergruppen}
        initialHiddenSondergruppenIds={currentUser.ausgeblendeteSondergruppenIds}
      />
    </div>
  );
}
