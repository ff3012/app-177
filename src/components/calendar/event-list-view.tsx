'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { CalendarEventInput } from './calendar-view';
import { AddToCalendarLink } from './add-to-calendar-link';

const DOUBLE_CLICK_WINDOW_MS = 220;

function formatStartTime(event: CalendarEventInput): string {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start);
  return start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function RsvpBadge({ counts }: { counts: NonNullable<CalendarEventInput['rsvpCounts']> }) {
  if (counts.ZUGESAGT === 0 && counts.ABGESAGT === 0 && counts.UNKLAR === 0) {
    return <span className="text-neutral-400">–</span>;
  }
  return (
    <span className="inline-flex gap-1 whitespace-nowrap">
      <span className="rounded bg-green-100 px-1 text-green-800">✓ {counts.ZUGESAGT}</span>
      <span className="rounded bg-red-100 px-1 text-red-800">✗ {counts.ABGESAGT}</span>
      <span className="rounded bg-neutral-200 px-1 text-neutral-700">? {counts.UNKLAR}</span>
    </span>
  );
}

/**
 * Ein Klick öffnet für JEDEN Benutzer (auch ohne Bearbeitungsrecht) die Detailansicht - ein
 * Doppelklick springt für editierbare Termine stattdessen direkt zum Bearbeiten-Formular. Da der
 * Browser bei einem Doppelklick trotzdem zuerst zwei einzelne click-Events feuert, wird der
 * Einzelklick-Sprung kurz verzögert und bei einem eintreffenden dblclick wieder verworfen -
 * sonst würde die Navigation aus dem ersten Klick bereits laufen, bevor der Doppelklick erkannt wird.
 */
function EventListRow({ event }: { event: CalendarEventInput }) {
  const router = useRouter();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = new Date(event.start);

  function handleClick() {
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      router.push(`/kalender/${event.id}`);
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleDoubleClick() {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    if (event.editable) router.push(`/kalender/${event.id}/bearbeiten`);
  }

  return (
    <tr
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
      title={event.editable ? 'Klick für Details, Doppelklick zum Bearbeiten' : 'Klick für Details'}
    >
      <td className="whitespace-nowrap px-3 py-1">{start.toLocaleDateString('de-AT')}</td>
      <td className="whitespace-nowrap px-3 py-1">{formatStartTime(event)}</td>
      <td className="whitespace-nowrap px-3 py-1">{start.toLocaleDateString('de-AT', { weekday: 'long' })}</td>
      <td className="break-words px-3 py-1">{event.title}</td>
      <td className="break-words px-3 py-1">{event.organizationName ?? '–'}</td>
      <td className="px-3 py-1">
        <RsvpBadge counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
      </td>
      <td className="whitespace-nowrap px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="inline-flex items-center gap-1.5">
          <a
            href={`/kalender/${event.id}`}
            className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-100"
            title="Zusage & Teilnehmerliste"
          >
            Zusage
          </a>
          <AddToCalendarLink eventId={event.id} variant="icon" />
        </div>
      </td>
    </tr>
  );
}

export function EventListView({ events }: { events: CalendarEventInput[] }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="border-b border-neutral-200 text-neutral-500">
          <tr>
            <th className="w-[11%] px-3 py-1.5">Datum</th>
            <th className="w-[8%] px-3 py-1.5">Start</th>
            <th className="w-[10%] px-3 py-1.5">Tag</th>
            <th className="w-[27%] px-3 py-1.5">Betreff</th>
            <th className="w-[13%] px-3 py-1.5">Organisation</th>
            <th className="w-[16%] px-3 py-1.5">Zusagen</th>
            <th className="w-[15%] px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <EventListRow key={event.id} event={event} />
          ))}
          {events.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                Keine Termine vorhanden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
