'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarView, type CalendarEventInput } from './calendar-view';
import { EventListView } from './event-list-view';
import { KalenderFiltersContent } from './kalender-filters-content';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useMobileHeader } from '@/components/layout/mobile-header-context';

export interface CalendarLayer {
  key: string;
  label: string;
}

export interface IcsLink {
  label: string;
  href: string;
  copyText: string;
}

interface KalenderWithLayersProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
  icsLinks: IcsLink[];
}

type ViewMode = 'calendar' | 'list';

function FilterIcon({ hasHiddenLayers }: { hasHiddenLayers: boolean }) {
  return (
    <span className="relative inline-flex">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {hasHiddenLayers && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand" aria-hidden />
      )}
    </span>
  );
}

// Ab lg: (1024px) - genau die Breite, an der der Seiten-Container (max-w-5xl) sein eigenes Maximum
// erreicht - wandern Ebenen/Legende/ICS in eine feste linke Sidebar, analog zum Mockup. Unterhalb
// lg: (Mobile-Brief.md V2-Mobile) verschwindet dieselbe Content-Komponente stattdessen komplett aus
// dem Seitenfluss und wandert hinter ein Filter-Icon in der Kopfleiste (via MobileHeaderContext) in
// ein Bottom Sheet - "Inhalt zuerst, Einstellungen dahinter" statt gestapelter Karten über dem Kalender.
export function KalenderWithLayers({ events, layers, icsLinks }: KalenderWithLayersProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.key, true])),
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sheetOpen, setSheetOpen] = useState(false);
  const { setActionSlot } = useMobileHeader();

  const hasHiddenLayers = Object.values(enabled).some((value) => value === false);

  useEffect(() => {
    setActionSlot(
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Kalender-Ebenen filtern"
        className="rounded p-1.5 hover:bg-white/10"
      >
        <FilterIcon hasHiddenLayers={hasHiddenLayers} />
      </button>,
    );
    return () => setActionSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHiddenLayers]);

  // Vergangene Termine werden nur in der Listenansicht ausgeblendet (siehe Issue #1) - fest, ohne
  // Umschalter. Die Kalenderansicht (Gitter) zeigt weiterhin jeden Monat vollständig, da ein
  // Kalendergitter mit ausgeblendeten vergangenen Tagen/Terminen eher verwirrend als aufgeräumt wirkt.
  const filteredEvents = useMemo(
    () => events.filter((event) => enabled[event.layer ?? ''] !== false),
    [events, enabled],
  );

  const sortedEvents = useMemo(() => {
    const now = Date.now();
    const listEvents = filteredEvents.filter((event) => new Date(event.end).getTime() >= now);
    return [...listEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [filteredEvents]);

  const showDrone = layers.some((layer) => layer.key === 'drohnengruppe');

  function handleToggle(key: string, checked: boolean) {
    setEnabled((prev) => ({ ...prev, [key]: checked }));
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="hidden lg:flex lg:w-64 lg:shrink-0">
        <KalenderFiltersContent
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          icsLinks={icsLinks}
        />
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Kalender-Ebenen">
        <KalenderFiltersContent
          layers={layers}
          enabled={enabled}
          onToggle={handleToggle}
          showDrone={showDrone}
          icsLinks={icsLinks}
        />
      </BottomSheet>

      <div className="flex flex-1 flex-col gap-4">
        <div className="flex sm:justify-end">
          <div className="flex w-full rounded-lg bg-neutral-100 p-1 shadow-sm sm:w-auto sm:bg-white">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium sm:flex-none ${
                viewMode === 'calendar'
                  ? 'bg-white text-neutral-900 shadow-sm sm:bg-brand sm:text-white sm:shadow-none'
                  : 'text-neutral-600 sm:hover:bg-neutral-100'
              }`}
            >
              Kalenderansicht
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium sm:flex-none ${
                viewMode === 'list'
                  ? 'bg-white text-neutral-900 shadow-sm sm:bg-brand sm:text-white sm:shadow-none'
                  : 'text-neutral-600 sm:hover:bg-neutral-100'
              }`}
            >
              Listenansicht
            </button>
          </div>
        </div>
        {viewMode === 'calendar' ? <CalendarView events={filteredEvents} /> : <EventListView events={sortedEvents} />}
      </div>
    </div>
  );
}
