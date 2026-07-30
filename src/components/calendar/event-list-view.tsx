'use client';

import { useRouter } from 'next/navigation';
import type { CalendarEventInput } from './calendar-view';
import { AddToCalendarLink } from './add-to-calendar-link';

function formatStartTime(event: CalendarEventInput): string {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start);
  return start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

export function EventListView({ events }: { events: CalendarEventInput[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-neutral-200 text-neutral-500">
          <tr>
            <th className="px-3 py-1.5">Datum</th>
            <th className="px-3 py-1.5">Start</th>
            <th className="px-3 py-1.5">Tag</th>
            <th className="px-3 py-1.5">Betreff</th>
            <th className="px-3 py-1.5">Organisation</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const start = new Date(event.start);
            return (
              <tr
                key={event.id}
                onDoubleClick={() => {
                  if (event.editable) router.push(`/kalender/${event.id}/bearbeiten`);
                }}
                className={`border-b border-neutral-100 ${event.editable ? 'cursor-pointer hover:bg-neutral-50' : ''}`}
                title={event.editable ? 'Doppelklick zum Bearbeiten' : undefined}
              >
                <td className="whitespace-nowrap px-3 py-1">{start.toLocaleDateString('de-AT')}</td>
                <td className="whitespace-nowrap px-3 py-1">{formatStartTime(event)}</td>
                <td className="whitespace-nowrap px-3 py-1">{start.toLocaleDateString('de-AT', { weekday: 'long' })}</td>
                <td className="px-3 py-1">{event.title}</td>
                <td className="whitespace-nowrap px-3 py-1">{event.organizationName ?? '–'}</td>
                <td className="whitespace-nowrap px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <AddToCalendarLink eventId={event.id} variant="icon" />
                </td>
              </tr>
            );
          })}
          {events.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                Keine Termine vorhanden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
