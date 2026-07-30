'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

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

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
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
                <td className="px-4 py-2">{flight.purposeLabel}</td>
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
            {visibleFlights.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                  Noch keine Flüge erfasst.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
