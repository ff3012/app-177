'use client';

import { useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import type { EventClickArg, EventContentArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import deLocale from '@fullcalendar/core/locales/de';
import { useRouter } from 'next/navigation';
import { AddToCalendarLink } from './add-to-calendar-link';
import { RsvpBadge } from './rsvp-badge';

export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  editable: boolean;
  backgroundColor?: string;
  description?: string;
  location?: string;
  organizationName?: string;
  category?: string;
  layer?: string;
  myRsvpStatus?: 'ZUGESAGT' | 'ABGESAGT' | 'UNKLAR' | null;
  rsvpCounts?: { ZUGESAGT: number; ABGESAGT: number; UNKLAR: number };
}

function formatEventTime(event: CalendarEventInput) {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const end = new Date(event.end).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  return `${start} – ${end}`;
}

/** Only adds the compact RSVP tally in dayGridMonth's small chips - timeGridWeek has different
 * space/interaction needs the mockup never addressed, so it keeps FullCalendar's plain time+title. */
function renderEventContent(arg: EventContentArg) {
  const showRsvp = arg.view.type === 'dayGridMonth' && arg.event.extendedProps.category === 'DROHNENGRUPPE';
  const rsvpCounts = arg.event.extendedProps.rsvpCounts as CalendarEventInput['rsvpCounts'];

  return (
    <div className="w-full overflow-hidden px-1 py-0.5 text-white">
      <div className="truncate text-[11px] font-medium leading-tight">
        {!arg.event.allDay && `${arg.timeText} `}
        {arg.event.title}
      </div>
      {showRsvp && rsvpCounts && <RsvpBadge counts={rsvpCounts} compact />}
    </div>
  );
}

export function CalendarView({ events }: { events: CalendarEventInput[] }) {
  const router = useRouter();
  const [viewEvent, setViewEvent] = useState<CalendarEventInput | null>(null);

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.editable) {
      router.push(`/kalender/${info.event.id}/bearbeiten`);
      return;
    }
    const event = events.find((e) => e.id === info.event.id);
    if (event) setViewEvent(event);
  }

  return (
    <div className="rounded-lg bg-white p-2 shadow-sm sm:p-3">
      <div className="overflow-x-auto">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={deLocale}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' }}
          height="auto"
          eventDisplay="block"
          events={events.map((event) => ({
            ...event,
            extendedProps: { editable: event.editable, rsvpCounts: event.rsvpCounts, category: event.category },
          }))}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
        />
      </div>

      {viewEvent && (
        // z-50: must sit above the mobile bottom tab bar (z-30) and profile dropdown (z-40) so
        // taps can't reach through to them while this is meant to be blocking.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setViewEvent(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-neutral-900">{viewEvent.title}</h2>
              <button
                type="button"
                onClick={() => setViewEvent(null)}
                className="text-neutral-400 hover:text-neutral-600"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Zeit</dt>
                <dd className="text-neutral-800">{formatEventTime(viewEvent)}</dd>
              </div>
              {viewEvent.organizationName && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
                  <dd className="text-neutral-800">{viewEvent.organizationName}</dd>
                </div>
              )}
              {viewEvent.location && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Ort</dt>
                  <dd className="text-neutral-800">{viewEvent.location}</dd>
                </div>
              )}
              {viewEvent.description && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Beschreibung</dt>
                  <dd className="whitespace-pre-wrap text-neutral-800">{viewEvent.description}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
              <AddToCalendarLink eventId={viewEvent.id} />
              <a href={`/kalender/${viewEvent.id}`} className="text-sm font-medium text-brand hover:underline">
                Zusage & Teilnehmerliste
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
