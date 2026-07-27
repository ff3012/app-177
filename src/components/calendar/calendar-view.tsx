'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { type EventClickArg } from '@fullcalendar/interaction';
import deLocale from '@fullcalendar/core/locales/de';
import { useRouter } from 'next/navigation';

export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  editable: boolean;
  backgroundColor?: string;
}

export function CalendarView({ events }: { events: CalendarEventInput[] }) {
  const router = useRouter();

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.editable) {
      router.push(`/kalender/${info.event.id}/bearbeiten`);
    }
  }

  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale={deLocale}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' }}
        height="auto"
        events={events.map((event) => ({ ...event, extendedProps: { editable: event.editable } }))}
        eventClick={handleEventClick}
      />
    </div>
  );
}
