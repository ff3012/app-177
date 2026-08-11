import Link from 'next/link';
import { PurposeBadge } from './purpose-badge';
import { FLIGHT_COLORS } from '@/lib/drone/flight-colors';

export interface FlightRowData {
  id: string;
  dayNumber: string;
  weekdayLabel: string;
  location: string;
  timeLabel: string;
  pilotName: string;
  droneName: string;
  purposeLabel: string;
  originLabel: string;
  editable: boolean;
}

function stripeColor(purposeLabel: string): string {
  return purposeLabel === 'Einsatz' ? '#e4322b' : FLIGHT_COLORS.uebungStripe;
}

/** Desktop-Zeile (>= sm:), ein Baustein einer Monatsgruppen-Karte. Ganze Zeile klickbar, öffnet
 * für editierbare Flüge direkt das Bearbeiten-Formular (Flüge haben keine Detail-Zwischenseite wie
 * Kalender-Termine, also kein Einzel-vs-Doppelklick-Unterschied nötig - ein einfacher Link genügt). */
export function FlightRow({ flight }: { flight: FlightRowData }) {
  // `w-full` ist notwendig, nicht kosmetisch: `content` ist ein Flex-Item des äußeren Link/div
  // (`sm:flex`, siehe unten) und Flex-Items wachsen per Default NICHT über ihre eigene Content-
  // Breite hinaus (flex-grow: 0). Ohne `w-full` bestimmt daher die Länge von Ort/Pilot/Drohne/
  // Erfasst-von jeder einzelnen Zeile deren Gesamtbreite - der "Bearbeiten"-Button (rechtsbündig
  // in einer festen Spalte) verschiebt sich dadurch zeilenweise horizontal, je nach Textlänge
  // (realer, gemeldeter Bug). `overflow-hidden`/`truncate` an den Text-Spalten unten verhindern
  // zusätzlich, dass ein einzelnes unbrechbares Wort (z. B. ein langer Nachname) seine Spalte über
  // die vorgesehene Breite hinaus aufdrückt - beide Fixes sind nötig, jeder für sich reicht nicht.
  const content = (
    <div className="flex w-full items-center gap-[18px] py-3.5 pr-5">
      <div className="w-[62px] shrink-0 text-center">
        <div className="font-condensed text-2xl font-bold leading-none text-ink">{flight.dayNumber}</div>
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{flight.weekdayLabel}</div>
      </div>
      <div className="min-w-[120px] flex-1 overflow-hidden">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[17px] font-semibold text-ink">{flight.location}</span>
          <PurposeBadge label={flight.purposeLabel} />
        </div>
        <div className="truncate text-sm text-ink-muted">
          {flight.timeLabel} · {flight.pilotName} · {flight.droneName}
        </div>
      </div>
      <div className="w-[168px] shrink-0 overflow-hidden text-xs text-ink-faint">{flight.originLabel}</div>
      <div className="flex w-[116px] shrink-0 justify-end">
        {flight.editable && (
          <span className="rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink-muted">
            Bearbeiten
          </span>
        )}
      </div>
    </div>
  );

  const rowStyle = { borderLeft: `5px solid ${stripeColor(flight.purposeLabel)}` };

  // FlightRow ist eine Server-Komponente (kein 'use client') - ein onClick-Handler auf dem <Link>
  // (selbst eine Client-Komponente) für den nicht-editierbaren Fall wie ursprünglich hier versucht
  // ("href='#' + preventDefault") ist in Next.js App Router unzulässig ("Event handlers cannot be
  // passed to Client Component props", bricht das gesamte <main>-Rendering) - stattdessen wie
  // FlightCard direkt darunter: zwei getrennte Zweige, nur der editierbare rendert einen echten
  // <Link>, der andere einen reinen <div>-Wrapper ohne jede Navigation/Handler.
  if (!flight.editable) {
    return (
      <div className="hidden border-b border-line pl-0 last:border-0 sm:flex" style={rowStyle}>
        {content}
      </div>
    );
  }

  return (
    <Link
      href={`/drohnen/${flight.id}/bearbeiten`}
      className="hidden border-b border-line pl-0 last:border-0 hover:bg-surface-sunken sm:flex"
      style={rowStyle}
    >
      {content}
    </Link>
  );
}

/** Mobile-Karte (< sm:), gleicher Dateninhalt wie FlightRow, vertikal gestapelt - Fortsetzung des
 * bestehenden FlightCard-Konzepts aus dem alten flight-table.tsx, an die neuen Datenfelder
 * (originLabel statt "Erfasst von {Name}", neues PurposeBadge-Farbschema) angepasst. */
export function FlightCard({ flight }: { flight: FlightRowData }) {
  const content = (
    <div className="flex flex-col gap-1 py-3 pl-3 pr-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">
          {flight.dayNumber}. {flight.weekdayLabel} · {flight.timeLabel}
        </span>
        {flight.editable && <span className="shrink-0 text-xs font-medium text-brand">Bearbeiten ›</span>}
      </div>
      <span className="text-sm text-ink">{flight.location}</span>
      <span className="text-sm text-ink-muted">
        {flight.pilotName} · {flight.droneName}
      </span>
      <span>
        <PurposeBadge label={flight.purposeLabel} />
      </span>
      <span className="text-xs text-ink-faint">{flight.originLabel}</span>
    </div>
  );

  return (
    <div className="border-b border-line last:border-0 sm:hidden" style={{ borderLeft: `4px solid ${stripeColor(flight.purposeLabel)}` }}>
      {flight.editable ? (
        <Link href={`/drohnen/${flight.id}/bearbeiten`} className="block active:bg-surface-sunken">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}
