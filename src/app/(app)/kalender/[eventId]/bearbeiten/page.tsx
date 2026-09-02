import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateAnySectionWideEvent, canCreateBezirksWideEvent, canManageEvent } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { getSondergruppeOptions } from '@/lib/calendar/sondergruppe-options';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
import { EventForm } from '@/components/calendar/event-form';
import { AddToCalendarLink } from '@/components/calendar/add-to-calendar-link';
import { toDatetimeLocalValue } from '@/lib/format';
import { deleteEvent, updateEvent } from '../../actions';

export default async function TerminBearbeitenPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireUser();
  const { eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return <p className="text-neutral-700">Termin wurde nicht gefunden.</p>;
  }

  // Vorher: canManageEventsFor(user, event.organizationId) - das war für Drohnengruppen-Termine
  // falsch (blockte jeden Admin Drohnengruppe ohne eigene Feuerwehr-Admin-Mitgliedschaft von seinen
  // EIGENEN Gruppen-Terminen). canManageEvent verzweigt jetzt korrekt nach event.category.
  const droneGroup =
    event.category === 'DROHNENGRUPPE' && event.droneGroupId
      ? await prisma.droneGroup.findUnique({
          where: { id: event.droneGroupId },
          select: { id: true, organizationId: true },
        })
      : null;
  if (!canManageEvent(user, event, droneGroup)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Termin zu bearbeiten.</p>;
  }
  if (event.vehicleBookingId) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <p className="text-neutral-700">
          Dieser Termin gehört zu einer Fahrzeug-Reservierung. Um ihn zu ändern oder zu stornieren, gehe zu{' '}
          <Link href="/meine-feuerwehr" className="text-brand hover:underline">
            Meine Feuerwehr
          </Link>
          .
        </p>
      </div>
    );
  }
  if (event.icsUid) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <p className="text-neutral-700">
          Dieser Termin stammt aus einem importierten Kalender (Verwaltung → Heimatfeuerwehr) und wird
          automatisch mit der Quelle synchronisiert. Änderungen sind nur im Quellkalender möglich.
        </p>
      </div>
    );
  }

  const [organizations, droneGroupOptions, sondergruppeOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { OR: [{ id: { in: user.feuerwehrAdminOrgIds }, isActive: true }, { id: event.organizationId }] },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user, event.category === 'DROHNENGRUPPE' ? event.droneGroupId : undefined),
    getSondergruppeOptions(event.sondergruppeId),
  ]);

  const boundUpdate = updateEvent.bind(null, event.id);
  const boundDelete = deleteEvent.bind(null, event.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <div className="flex items-center gap-3">
          <AddToCalendarLink eventId={event.id} />
          <Link href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
            Zusage & Teilnehmerliste
          </Link>
        </div>
      </div>
      <EventForm
        organizations={organizations}
        canSectionWide={canCreateAnySectionWideEvent(user)}
        canDistrictWide={canCreateBezirksWideEvent(user)}
        droneGroupOptions={droneGroupOptions}
        sondergruppeOptions={sondergruppeOptions}
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
          isDistrictWide: event.isDistrictWide,
          category: event.category,
          droneGroupId: event.droneGroupId ?? (event.category === 'DROHNENGRUPPE' ? BEZIRKSWEIT_DRONE_GROUP_VALUE : null),
          sondergruppeId: event.sondergruppeId,
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
