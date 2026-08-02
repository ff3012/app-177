import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor, canViewEvent } from '@/lib/auth/permissions';
import { AddToCalendarLink } from '@/components/calendar/add-to-calendar-link';
import { EventRsvpButtons } from '@/components/calendar/event-rsvp-buttons';
import { SendEventPushButton } from '@/components/calendar/send-event-push-button';
import type { RsvpStatusOption } from '@/lib/validation/rsvp.schema';

const STATUS_LABEL: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'Zugesagt',
  ABGESAGT: 'Abgesagt',
  UNKLAR: 'Unklar',
};

const STATUS_BADGE_CLASS: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'bg-green-100 text-green-800',
  ABGESAGT: 'bg-red-100 text-red-800',
  UNKLAR: 'bg-neutral-200 text-neutral-700',
};

function formatEventTime(startsAt: Date, endsAt: Date, allDay: boolean): string {
  if (allDay) return 'Ganztägig';
  const start = startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const end = endsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  return `${start} – ${end}`;
}

export default async function TerminDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireUser();
  const { eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organization: true } });
  if (!event) {
    return <p className="text-neutral-700">Termin wurde nicht gefunden.</p>;
  }
  if (!canViewEvent(user, event)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Termin zu sehen.</p>;
  }

  const zusagen = await prisma.terminZusage.findMany({
    where: { eventId },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });

  const counts: Record<RsvpStatusOption, number> = { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 };
  for (const zusage of zusagen) counts[zusage.status] += 1;

  const ownZusage = zusagen.find((zusage) => zusage.user.id === user.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">{event.title}</h1>
        <div className="flex items-center gap-3">
          <AddToCalendarLink eventId={event.id} />
          {canManageEventsFor(user, event.organizationId) && !event.vehicleBookingId && (
            <Link href={`/kalender/${event.id}/bearbeiten`} className="text-sm text-brand hover:underline">
              Bearbeiten
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-white p-4 text-sm shadow-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Zeit</dt>
          <dd className="text-neutral-800">{formatEventTime(event.startsAt, event.endsAt, event.allDay)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
          <dd className="text-neutral-800">{event.organization.shortName ?? event.organization.name}</dd>
        </div>
        {event.location && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Ort</dt>
            <dd className="text-neutral-800">{event.location}</dd>
          </div>
        )}
        {event.description && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Beschreibung</dt>
            <dd className="whitespace-pre-wrap text-neutral-800">{event.description}</dd>
          </div>
        )}
      </div>

      {canManageEventsFor(user, event.organizationId) && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Push-Benachrichtigung</h2>
          <SendEventPushButton eventId={event.id} />
        </div>
      )}

      {!event.vehicleBookingId && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Meine Zusage</h2>
          <EventRsvpButtons
            eventId={event.id}
            initialStatus={ownZusage?.status ?? null}
            initialNote={ownZusage?.note ?? ''}
            withNote
          />
        </div>
      )}

      {!event.vehicleBookingId && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
            Teilnehmerliste
            <span className="flex gap-1.5 text-xs font-normal">
              {(Object.keys(STATUS_LABEL) as RsvpStatusOption[]).map((status) => (
                <span key={status} className={`rounded px-1.5 py-0.5 ${STATUS_BADGE_CLASS[status]}`}>
                  {STATUS_LABEL[status]}: {counts[status]}
                </span>
              ))}
            </span>
          </h2>
          {zusagen.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Zusagen.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {zusagen.map((zusage) => (
                <li key={zusage.id} className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASS[zusage.status]}`}>
                    {STATUS_LABEL[zusage.status]}
                  </span>
                  <span className="text-neutral-800">
                    {zusage.user.firstName} {zusage.user.lastName}
                  </span>
                  {zusage.note && <span className="text-xs text-neutral-500">„{zusage.note}“</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
