'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { CalendarEventInput } from './calendar-view';
import { AddToCalendarLink } from './add-to-calendar-link';
import { RsvpBadge } from './rsvp-badge';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';

const DOUBLE_CLICK_WINDOW_MS = 220;

function formatStartTime(event: CalendarEventInput): string {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start);
  return start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Ein Klick öffnet für JEDEN Benutzer (auch ohne Bearbeitungsrecht) die Detailansicht - ein
 * Doppelklick springt für editierbare Termine stattdessen direkt zum Bearbeiten-Formular. Da der
 * Browser bei einem Doppelklick trotzdem zuerst zwei einzelne click-Events feuert, wird der
 * Einzelklick-Sprung kurz verzögert und bei einem eintreffenden dblclick wieder verworfen -
 * sonst würde die Navigation aus dem ersten Klick bereits laufen, bevor der Doppelklick erkannt wird.
 * Geteilt zwischen der Tabellenzeile (breite Bildschirme) und der Karte (schmale Bildschirme).
 */
function useRowClick(eventId: string, editable: boolean) {
  const router = useRouter();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      router.push(`/kalender/${eventId}`);
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleDoubleClick() {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    if (editable) router.push(`/kalender/${eventId}/bearbeiten`);
  }

  return { handleClick, handleDoubleClick };
}

function EventListRow({ event }: { event: CalendarEventInput }) {
  const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
  const start = new Date(event.start);

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

/** Kartenansicht für schmale Bildschirme (Handy) - eine 7-spaltige Tabelle passt dort nicht lesbar
 * hin. Die Datums-Badge-Spalte + farbige Akzentleiste (Farbe aus layer-colors.ts, dieselbe Quelle
 * wie die Termin-Chips im Kalendergitter und die Legende) übernimmt die visuelle Zuordnung, die im
 * Gitter über die Chip-Farbe passiert - hier gibt es keine Chips, nur die Karte selbst. */
function EventCard({ event }: { event: CalendarEventInput }) {
  const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
  const start = new Date(event.start);
  const accentColor = LAYER_COLORS[event.layer ?? ''] ?? '#8e8e93';

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="flex cursor-pointer gap-3 border-b border-neutral-100 py-3 pl-0 pr-4 active:bg-neutral-50"
    >
      <div className="flex shrink-0 items-stretch gap-2 pl-4">
        <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
        <div className="flex w-9 flex-col items-center pt-0.5">
          <span className="text-lg font-bold leading-none text-neutral-900">{start.getDate()}</span>
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">
            {start.toLocaleDateString('de-AT', { weekday: 'short' })}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm text-neutral-600">{formatStartTime(event)}</span>
          <RsvpBadge counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
        </div>
        <span className="font-medium text-neutral-900">{event.title}</span>
        <div className="text-sm text-neutral-500">{event.organizationName ?? '–'}</div>
        <div className="mt-1 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <a href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
            Zusage & Details
          </a>
          <AddToCalendarLink eventId={event.id} variant="icon" />
        </div>
      </div>
    </div>
  );
}

export function EventListView({ events }: { events: CalendarEventInput[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
        Keine Termine vorhanden.
      </div>
    );
  }

  return (
    <>
      {/* Kartenansicht: unter sm (< 640px), z. B. Smartphones im Hochformat */}
      <div className="flex flex-col rounded-xl bg-white shadow-sm sm:hidden">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>

      {/* Tabellenansicht: ab sm aufwärts */}
      <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm sm:block">
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
          </tbody>
        </table>
      </div>
    </>
  );
}
