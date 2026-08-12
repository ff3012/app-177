'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import type { CalendarEventInput } from './calendar-view';
import { AddToCalendarLink } from './add-to-calendar-link';
import { RsvpBadge } from './rsvp-badge';
import { VehicleBookingIcon } from './vehicle-booking-icon';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';
import { setRsvp } from '@/app/(app)/kalender/[eventId]/rsvp-actions';

const DOUBLE_CLICK_WINDOW_MS = 220;

function formatStartTime(event: CalendarEventInput): string {
  if (event.allDay) return 'Ganztägig';
  const start = new Date(event.start);
  return start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function formatTimeRange(event: CalendarEventInput): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startLabel = start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const endLabel = end.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${startLabel}–${endLabel}`;
}

/**
 * Ein Klick öffnet für JEDEN Benutzer (auch ohne Bearbeitungsrecht) die Detailansicht - ein
 * Doppelklick springt für editierbare Termine stattdessen direkt zum Bearbeiten-Formular. Da der
 * Browser bei einem Doppelklick trotzdem zuerst zwei einzelne click-Events feuert, wird der
 * Einzelklick-Sprung kurz verzögert und bei einem eintreffenden dblclick wieder verworfen -
 * sonst würde die Navigation aus dem ersten Klick bereits laufen, bevor der Doppelklick erkannt wird.
 * Geteilt zwischen der Tabellenzeile, der mobilen Karte und der neuen Desktop-Monatsgruppen-Zeile.
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
      <td className="break-words px-3 py-1">
        {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
        {event.isDistrictWideDrone && (
          <span className="mr-1 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Bezirksweit
          </span>
        )}
        {event.title}
      </td>
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
        <span className="font-medium text-neutral-900">
          {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
          {event.isDistrictWideDrone && (
            <span className="mr-1 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Bezirksweit
            </span>
          )}
          {event.title}
        </span>
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

/* ---------------- Desktop (lg:+) Monatsgruppen-Ansicht (Kalender Browser.dc.html) ---------------- */

const MONTH_LABELS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

interface MonthGroup {
  key: string;
  label: string;
  events: CalendarEventInput[];
}

/** events ist bereits chronologisch sortiert (kalender-with-layers.tsx) - hier nur noch nach
 * Jahr+Monat in aufeinanderfolgende Gruppen zusammengefasst, ohne erneut zu sortieren. */
function groupEventsByMonth(events: CalendarEventInput[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const event of events) {
    const start = new Date(event.start);
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({ key, label: `${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`, events: [event] });
    }
  }
  return groups;
}

function RsvpCountChips({ counts }: { counts: NonNullable<CalendarEventInput['rsvpCounts']> }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <span
        className="min-w-[34px] rounded px-2 py-1 text-center text-xs font-semibold"
        style={{ backgroundColor: '#eaf6f0', color: '#1b7a52' }}
      >
        {counts.ZUGESAGT}
      </span>
      <span
        className="min-w-[34px] rounded px-2 py-1 text-center text-xs font-semibold"
        style={{ backgroundColor: '#fdeeed', color: '#a33530' }}
      >
        {counts.ABGESAGT}
      </span>
      <span
        className="min-w-[34px] rounded px-2 py-1 text-center text-xs font-semibold"
        style={{ backgroundColor: '#f2f2f4', color: '#6c6c70' }}
      >
        {counts.UNKLAR}
      </span>
    </div>
  );
}

type RsvpStatus = 'ZUGESAGT' | 'ABGESAGT' | 'UNKLAR';

const RSVP_STATUS_LABEL: Record<RsvpStatus, string> = {
  ZUGESAGT: 'Zugesagt',
  ABGESAGT: 'Abgesagt',
  UNKLAR: 'Unklar',
};

const RSVP_STATUS_CLASS: Record<RsvpStatus, string> = {
  ZUGESAGT: 'bg-[#eaf6f0] text-[#1b7a52]',
  ABGESAGT: 'bg-[#fdeeed] text-[#a33530]',
  UNKLAR: 'bg-neutral-100 text-neutral-600',
};

interface DesktopEventRowProps {
  event: CalendarEventInput;
  overrideStatus?: 'ZUGESAGT' | 'ABGESAGT';
  pending: boolean;
  expanded: boolean;
  onRespond: (eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') => void;
  onToggleExpand: (eventId: string) => void;
}

/** Zeile der neuen Desktop-Monatsgruppen-Ansicht (Kalender Browser.dc.html, nur ab lg:) - eigene
 * Komponente statt Wiederverwendung von EventListRow, da Layout (Farbstreifen links, Datumsblock,
 * Inline-Zusage/Absage, Aufklapp-Panel) grundlegend anders ist als die Tabellenzeile. Bei
 * Fahrzeug-Reservierungen (kein Zusage-Konzept, siehe rsvp-actions.ts's eigene Sperre dafür) gibt
 * es weder RSVP-Chips noch Aufklapp-Chevron, nur einen "Buchung öffnen"-Button. */
function DesktopEventRow({ event, overrideStatus, pending, expanded, onRespond, onToggleExpand }: DesktopEventRowProps) {
  const { handleClick, handleDoubleClick } = useRowClick(event.id, event.editable);
  const start = new Date(event.start);
  const accentColor = LAYER_COLORS[event.layer ?? ''] ?? '#8e8e93';
  const status = overrideStatus ?? event.myRsvpStatus ?? null;

  return (
    <div className="border-b border-neutral-100 last:border-b-0" style={{ borderLeft: `5px solid ${accentColor}` }}>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className="flex cursor-pointer items-center gap-4 py-3 pl-4 pr-4 hover:bg-neutral-50"
        title={event.editable ? 'Klick für Details, Doppelklick zum Bearbeiten' : 'Klick für Details'}
      >
        <div className="w-14 shrink-0 text-center">
          <div className="text-2xl font-bold leading-none text-neutral-900">
            {String(start.getDate()).padStart(2, '0')}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {start.toLocaleDateString('de-AT', { weekday: 'short' })}
          </div>
        </div>

        <div className="min-w-[120px] flex-1">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-neutral-900">
            {event.isVehicleBooking && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Fahrzeug
              </span>
            )}
            {event.isDistrictWideDrone && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Bezirksweit
              </span>
            )}
            <Link href={`/kalender/${event.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              {event.title}
            </Link>
          </div>
          <div className="text-sm text-neutral-500">
            {event.isVehicleBooking ? formatTimeRange(event) : formatStartTime(event)}
            {event.organizationName ? ` · ${event.organizationName}` : ''}
          </div>
        </div>

        {event.isVehicleBooking ? (
          <div
            className="flex shrink-0 justify-end"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <a
              href={`/kalender/${event.id}`}
              className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Buchung öffnen
            </a>
          </div>
        ) : (
          <>
            <RsvpCountChips counts={event.rsvpCounts ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 }} />
            <div
              className="flex shrink-0 items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {status ? (
                <span className={`rounded px-3 py-2 text-sm font-semibold ${RSVP_STATUS_CLASS[status]}`}>
                  {RSVP_STATUS_LABEL[status]}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onRespond(event.id, 'ZUGESAGT')}
                    className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Zusage
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onRespond(event.id, 'ABGESAGT')}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 disabled:opacity-60"
                  >
                    Absage
                  </button>
                </>
              )}
              <AddToCalendarLink eventId={event.id} variant="icon" />
              <button
                type="button"
                onClick={() => onToggleExpand(event.id)}
                aria-label={expanded ? 'Details einklappen' : 'Details aufklappen'}
                className="inline-flex shrink-0 rounded border border-neutral-300 bg-white px-2 py-2 text-neutral-500 hover:bg-neutral-100"
              >
                <span className={`inline-block transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
              </button>
            </div>
          </>
        )}
      </div>

      {expanded && (event.description || event.location) && (
        <div
          className="border-t border-neutral-100 bg-neutral-50 py-3 pl-[72px] pr-4 text-sm text-neutral-600"
          onClick={(e) => e.stopPropagation()}
        >
          {event.location && <div className="mb-1 font-medium text-neutral-700">{event.location}</div>}
          {event.description && <div className="whitespace-pre-wrap">{event.description}</div>}
        </div>
      )}
    </div>
  );
}

/** Hält den optimistischen Zusage/Absage-Zustand und das Aufklapp-Panel pro Zeile - exakt dasselbe
 * Muster wie HomeTodoList's responded/pending (siehe home-todo-list.tsx): sofortiges UI-Update,
 * Rollback + Toast bei einem Serverfehler, kein Seitenwechsel. */
function DesktopMonthList({ events }: { events: CalendarEventInput[] }) {
  const [overrideStatus, setOverrideStatus] = useState<Record<string, 'ZUGESAGT' | 'ABGESAGT'>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function handleRespond(eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') {
    setOverrideStatus((current) => ({ ...current, [eventId]: status }));
    setPending((current) => ({ ...current, [eventId]: true }));

    const result = await setRsvp(eventId, status);

    setPending((current) => ({ ...current, [eventId]: false }));
    if (result.error) {
      setOverrideStatus((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      toast.error(result.error);
    }
  }

  function handleToggleExpand(eventId: string) {
    setExpanded((current) => ({ ...current, [eventId]: !current[eventId] }));
  }

  const groups = groupEventsByMonth(events);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <div className="pl-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group.label}</div>
          <div className="overflow-hidden rounded-lg bg-white shadow-sm">
            {group.events.map((event) => (
              <DesktopEventRow
                key={event.id}
                event={event}
                overrideStatus={overrideStatus[event.id]}
                pending={Boolean(pending[event.id])}
                expanded={Boolean(expanded[event.id])}
                onRespond={handleRespond}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventListView({
  events,
  desktopEvents,
}: {
  events: CalendarEventInput[];
  desktopEvents?: CalendarEventInput[];
}) {
  const eventsForDesktop = desktopEvents ?? events;

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

      {/* Tabellenansicht: sm bis unter lg (Tablet) - unverändert, jetzt auf diesen Bereich begrenzt */}
      <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm sm:block lg:hidden">
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

      {/* Monatsgruppen-Ansicht: ab lg (Kalender Browser.dc.html) - bekommt eine eigene,
          ggf. nach Status gefilterte Liste (desktopEvents), damit der Status-Filter strukturell
          nie die Tablet-Tabelle/mobile Kartenliste beeinflussen kann, auch nicht bei einer
          Fenstergrößenänderung während ein Filter-Chip aktiv ist. */}
      <div className="hidden lg:block">
        {eventsForDesktop.length === 0 ? (
          <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
            Keine Termine für diese Auswahl.
          </div>
        ) : (
          <DesktopMonthList events={eventsForDesktop} />
        )}
      </div>
    </>
  );
}
