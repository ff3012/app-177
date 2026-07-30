'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { PurposeBadge } from './purpose-badge';

const EMPTY_MESSAGE = 'Noch keine Flüge erfasst.';

export interface FlightRow {
  id: string;
  startsAtLabel: string;
  pilotName: string;
  pilotUserId: string;
  location: string;
  droneName: string;
  purposeLabel: string;
  registeredByName: string;
  registeredById: string;
  editable: boolean;
}

interface FlightTableProps {
  flights: FlightRow[];
  currentUserId: string;
  /** Ob dieser Benutzer überhaupt zwischen "alle" und "nur eigene" umschalten darf (Admin Drohnengruppe). */
  canToggle: boolean;
}

/** Kartenansicht für schmale Bildschirme (Handy) - eine 7-spaltige Tabelle passt dort nicht lesbar
 * hin, analog zu EventCard in components/calendar/event-list-view.tsx. Die ganze Karte ist der
 * Bearbeiten-Link (statt eines kleinen Text-Links), aber nur wenn der Flug editierbar ist. */
function FlightCard({ flight }: { flight: FlightRow }) {
  const content = (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-neutral-900">{flight.startsAtLabel}</span>
        {flight.editable && <span className="text-xs font-medium text-brand">Bearbeiten ›</span>}
      </div>
      <span className="text-sm text-neutral-700">{flight.pilotName}</span>
      <span className="text-sm text-neutral-500">
        {flight.location} · {flight.droneName}
      </span>
      <span>
        <PurposeBadge label={flight.purposeLabel} />
      </span>
      <span className="text-xs text-neutral-400">Erfasst von {flight.registeredByName}</span>
    </div>
  );

  if (!flight.editable) {
    return <div className="border-b border-neutral-100 px-4 py-3 last:border-0">{content}</div>;
  }

  return (
    <Link
      href={`/drohnen/${flight.id}/bearbeiten`}
      className="block border-b border-neutral-100 px-4 py-3 last:border-0 active:bg-neutral-50"
    >
      {content}
    </Link>
  );
}

/**
 * Der Toggle filtert rein clientseitig innerhalb der bereits geladenen Flüge - Admin Drohnengruppe
 * bekommt serverseitig ohnehin immer alle Flüge geladen (siehe drohnen/page.tsx), daher ist dies
 * keine Berechtigungsgrenze, nur eine Anzeige-Präferenz. Default an (alle einsehen).
 */
export function FlightTable({ flights, currentUserId, canToggle }: FlightTableProps) {
  const [showAll, setShowAll] = useState(true);

  const visibleFlights = useMemo(() => {
    if (!canToggle || showAll) return flights;
    return flights.filter((flight) => flight.registeredById === currentUserId || flight.pilotUserId === currentUserId);
  }, [flights, canToggle, showAll, currentUserId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-neutral-500">
          {!canToggle
            ? 'Deine eigenen Einträge sowie Flüge, bei denen du Pilot bist.'
            : showAll
              ? 'Alle Einträge (Admin-Ansicht).'
              : 'Nur deine eigenen Einträge sowie Flüge, bei denen du Pilot bist.'}
        </p>
        {canToggle && (
          <ToggleSwitch label="Alle Flüge einsehen" checked={showAll} onChange={setShowAll} />
        )}
      </div>

      {visibleFlights.length === 0 ? (
        <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">{EMPTY_MESSAGE}</div>
      ) : (
        <>
          <div className="flex flex-col rounded-lg bg-white shadow-sm sm:hidden">
            {visibleFlights.map((flight) => (
              <FlightCard key={flight.id} flight={flight} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Datum/Uhrzeit</th>
                  <th className="px-4 py-2">Pilot</th>
                  <th className="px-4 py-2">Ort</th>
                  <th className="px-4 py-2">Drohne</th>
                  <th className="px-4 py-2">Zweck</th>
                  <th className="px-4 py-2">Erstellt von</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleFlights.map((flight) => (
                  <tr key={flight.id} className="border-b border-neutral-100">
                    <td className="px-4 py-2">{flight.startsAtLabel}</td>
                    <td className="px-4 py-2">{flight.pilotName}</td>
                    <td className="px-4 py-2">{flight.location}</td>
                    <td className="px-4 py-2">{flight.droneName}</td>
                    <td className="px-4 py-2">
                      <PurposeBadge label={flight.purposeLabel} />
                    </td>
                    <td className="px-4 py-2">{flight.registeredByName}</td>
                    <td className="px-4 py-2 text-right">
                      {flight.editable && (
                        <Link href={`/drohnen/${flight.id}/bearbeiten`} className="text-brand hover:underline">
                          Bearbeiten
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
