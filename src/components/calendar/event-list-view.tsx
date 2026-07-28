'use client';

import type { CalendarEventInput } from './calendar-view';

const CATEGORY_LABEL: Record<string, string> = {
  ALLGEMEIN: 'Allgemein',
  DROHNENGRUPPE: 'Drohnengruppe',
};

function formatTimeRange(event: CalendarEventInput): string {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startTime = start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return startTime === endTime ? startTime : `${startTime}–${endTime}`;
}

export function EventListView({ events }: { events: CalendarEventInput[] }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-neutral-500">
          <tr>
            <th className="px-4 py-2">Datum</th>
            <th className="px-4 py-2">Uhrzeit</th>
            <th className="px-4 py-2">Tag</th>
            <th className="px-4 py-2">Betreff</th>
            <th className="px-4 py-2">Organisation</th>
            <th className="px-4 py-2">Kategorie</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const start = new Date(event.start);
            return (
              <tr key={event.id} className="border-b border-neutral-100">
                <td className="whitespace-nowrap px-4 py-2">{start.toLocaleDateString('de-AT')}</td>
                <td className="whitespace-nowrap px-4 py-2">{formatTimeRange(event)}</td>
                <td className="whitespace-nowrap px-4 py-2">{start.toLocaleDateString('de-AT', { weekday: 'long' })}</td>
                <td className="px-4 py-2">{event.title}</td>
                <td className="whitespace-nowrap px-4 py-2">{event.organizationName ?? '–'}</td>
                <td className="whitespace-nowrap px-4 py-2">
                  {(event.category && CATEGORY_LABEL[event.category]) ?? event.category ?? '–'}
                </td>
              </tr>
            );
          })}
          {events.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                Keine Termine vorhanden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
