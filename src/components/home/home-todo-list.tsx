'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { setRsvp } from '@/app/(app)/kalender/[eventId]/rsvp-actions';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';
import type { RsvpStatusOption } from '@/lib/validation/rsvp.schema';

export interface HomeEventCardData {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  organizationName: string;
  layer: 'own' | 'abschnitt' | 'drohnengruppe';
  myStatus: RsvpStatusOption | null;
  /** Gesetzt, wenn der Betrachter diese Organisation verwaltet (canManageEventsFor) - Startbildschirm-
   * Brief.md §4: "Beim Kommandanten zeigt die Terminkarte zusätzlich den Rückmeldestand der Mannschaft
   * statt der eigenen Zu-/Absage-Buttons." */
  tally: { zugesagt: number; offen: number } | null;
}

export interface StaticTodoItemData {
  id: string;
  severity: 'red' | 'amber';
  eyebrow: string;
  title: string;
  detail: string;
  href: string;
}

const STATUS_BADGE_LABEL: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'Zugesagt',
  ABGESAGT: 'Abgesagt',
  UNKLAR: 'Unklar',
};

const STATUS_BADGE_CLASS: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'bg-[#eaf6f0] text-[#1b7a52]',
  ABGESAGT: 'bg-red-50 text-red-700',
  UNKLAR: 'bg-neutral-100 text-neutral-600',
};

const WEEKDAY_ABBR = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTH_ABBR = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function formatEventLine(event: HomeEventCardData): string {
  const day = `${WEEKDAY_ABBR[event.startsAt.getDay()]} ${String(event.startsAt.getDate()).padStart(2, '0')}.${String(event.startsAt.getMonth() + 1).padStart(2, '0')}.`;
  const time = event.allDay ? 'Ganztägig' : `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`;
  const place = event.location || event.organizationName;
  return `${day} · ${time} · ${place}`;
}

function formatDaysUntilLabel(startsAt: Date): string {
  const days = Math.ceil((startsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'heute';
  if (days === 1) return 'in 1 Tag';
  return `in ${days} Tagen`;
}

function TallyFooter({ tally, eventId }: { tally: { zugesagt: number; offen: number }; eventId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#f0f0f2] pt-3">
      <span className="flex items-center gap-3.5 text-sm font-medium text-[#48484c]">
        <span className="flex items-center gap-1.5">
          <span className="h-[9px] w-[9px] rounded-full bg-[#22a06b]" />
          {tally.zugesagt} zugesagt
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[9px] w-[9px] rounded-full bg-[#c9c9ce]" />
          {tally.offen} offen
        </span>
      </span>
      <Link href={`/kalender/${eventId}`} className="text-sm font-medium text-brand">
        Details
      </Link>
    </div>
  );
}

interface RsvpTodoCardProps {
  event: HomeEventCardData;
  pending: boolean;
  onRespond: (eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') => void;
}

function RsvpTodoCard({ event, pending, onRespond }: RsvpTodoCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border-l-4 border-brand bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[#c62828]">Rückmeldung offen</span>
        <span className="flex-none text-[13px] font-medium text-[#8e8e93]">{formatDaysUntilLabel(event.startsAt)}</span>
      </div>
      <div>
        <div className="text-[18px] font-semibold leading-tight text-[#1c1c1e]">{event.title}</div>
        <div className="mt-0.5 text-[14px] text-[#6c6c70]">{formatEventLine(event)}</div>
      </div>
      {event.tally ? (
        <TallyFooter tally={event.tally} eventId={event.id} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onRespond(event.id, 'ZUGESAGT')}
            className="h-11 rounded-lg bg-brand text-[15px] font-semibold text-white disabled:opacity-60"
          >
            Zusagen
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRespond(event.id, 'ABGESAGT')}
            className="h-11 rounded-lg border border-[#d6d6da] text-[15px] font-medium text-[#48484c] disabled:opacity-60"
          >
            Absagen
          </button>
        </div>
      )}
    </div>
  );
}

function StaticTodoCard({ item }: { item: StaticTodoItemData }) {
  return (
    <Link
      href={item.href}
      className={`flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm ${
        item.severity === 'red' ? 'border-l-4 border-brand' : 'border-l-4 border-[#f0a92c]'
      }`}
    >
      <div className="min-w-0">
        <div
          className={`mb-1.5 text-[12px] font-semibold uppercase tracking-wide ${
            item.severity === 'red' ? 'text-[#c62828]' : 'text-[#8a6113]'
          }`}
        >
          {item.eyebrow}
        </div>
        <div className="text-[17px] font-semibold leading-tight text-[#1c1c1e]">{item.title}</div>
        <div className="mt-0.5 text-[14px] text-[#6c6c70]">{item.detail}</div>
      </div>
      <span className="flex-none text-[22px] leading-none text-[#c9c9ce]">›</span>
    </Link>
  );
}

function UpcomingEventRow({ event, isLast }: { event: HomeEventCardData; isLast: boolean }) {
  const monthLabel = MONTH_ABBR[event.startsAt.getMonth()].toUpperCase();
  return (
    <Link
      href={`/kalender/${event.id}`}
      className={`flex items-center gap-3.5 px-4 py-3.5 ${isLast ? '' : 'border-b border-[#f0f0f2]'}`}
    >
      <div className="w-[42px] flex-none text-center">
        <div className="font-condensed text-[21px] font-bold leading-none text-[#1c1c1e]">
          {String(event.startsAt.getDate()).padStart(2, '0')}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">{monthLabel}</div>
      </div>
      <div className="w-[3px] flex-none self-stretch rounded" style={{ background: LAYER_COLORS[event.layer] }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold leading-tight text-[#1c1c1e]">{event.title}</div>
        <div className="truncate text-[14px] text-[#6c6c70]">
          {event.allDay ? 'Ganztägig' : formatTime(event.startsAt)} · {event.location || event.organizationName}
        </div>
      </div>
      {event.tally ? (
        <span className="flex-none text-[12px] font-semibold text-[#1b7a52]">{event.tally.zugesagt} zugesagt</span>
      ) : event.myStatus ? (
        <span className={`flex-none rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATUS_BADGE_CLASS[event.myStatus]}`}>
          {STATUS_BADGE_LABEL[event.myStatus]}
        </span>
      ) : (
        <span className="flex-none text-[22px] leading-none text-[#c9c9ce]">›</span>
      )}
    </Link>
  );
}

interface HomeTodoListProps {
  rsvpTodos: HomeEventCardData[];
  staticTodos: StaticTodoItemData[];
  upcomingPool: HomeEventCardData[];
}

/**
 * Startbildschirm-Brief.md §1: "Zu erledigen" (offene Rückmeldungen + Atemschutz/90-Tage-Hinweise)
 * und "Als Nächstes" (die nächsten zwei Termine) - eine Client-Komponente, weil das Zu-/Absagen einer
 * Rückmeldung die Karte OHNE Seitenwechsel/Nachladen optimistisch von einem Block in den anderen
 * verschieben muss ("Nach dem Tippen: optimistisches Update, Karte wandert...bei Serverfehler
 * zurücksetzen und Toast zeigen"). rsvpTodos/upcomingPool kommen serverseitig bereits getrennt (ein
 * Termin mit offener Rückmeldung erscheint hier NIE gleichzeitig in beiden Arrays), `responded` hält
 * nur die client-seitige Überschreibung für bereits beantwortete rsvpTodos.
 */
export function HomeTodoList({ rsvpTodos, staticTodos, upcomingPool }: HomeTodoListProps) {
  const [responded, setResponded] = useState<Record<string, RsvpStatusOption>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  async function handleRespond(eventId: string, status: 'ZUGESAGT' | 'ABGESAGT') {
    setResponded((current) => ({ ...current, [eventId]: status }));
    setPending((current) => ({ ...current, [eventId]: true }));

    const result = await setRsvp(eventId, status);

    setPending((current) => ({ ...current, [eventId]: false }));
    if (result.error) {
      setResponded((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      toast.error(result.error);
    }
  }

  const openRsvpTodos = rsvpTodos.filter((event) => !responded[event.id]);
  const movedIntoUpcoming = rsvpTodos
    .filter((event) => responded[event.id])
    .map((event) => ({ ...event, myStatus: responded[event.id] }));

  const upcoming = [...upcomingPool, ...movedIntoUpcoming]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 2);

  const todoCount = openRsvpTodos.length + staticTodos.length;

  return (
    <div className="flex flex-col gap-4">
      {todoCount > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Zu erledigen</span>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[12px] font-bold text-white">
              {todoCount}
            </span>
          </div>
          {openRsvpTodos.map((event) => (
            <RsvpTodoCard key={event.id} event={event} pending={Boolean(pending[event.id])} onRespond={handleRespond} />
          ))}
          {staticTodos.map((item) => (
            <StaticTodoCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Als Nächstes</span>
          <Link href="/kalender" className="text-sm font-medium text-brand">
            Kalender
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-neutral-500 shadow-sm">Keine kommenden Termine.</p>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {upcoming.map((event, index) => (
              <UpcomingEventRow key={event.id} event={event} isLast={index === upcoming.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
