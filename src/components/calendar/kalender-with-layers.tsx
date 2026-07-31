'use client';

import { useMemo, useState } from 'react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { CalendarView, type CalendarEventInput } from './calendar-view';
import { EventListView } from './event-list-view';
import { LayerLegend } from './layer-legend';

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

// Ab lg: (1024px) - genau die Breite, an der der Seiten-Container (max-w-5xl) sein eigenes Maximum
// erreicht - wandern Ebenen/Legende/ICS in eine feste linke Sidebar, analog zum Mockup. Darunter
// bleibt die bisherige gestapelte Anordnung (auch auf Tablet-Breite) unverändert; das ist bewusst
// der erste `lg:`-Einsatz in diesem Codebase (bisher nur `sm:` irgendwo verwendet), da eine
// Sidebar bei 640px schlicht nicht genug Platz neben dem Kalendergitter hätte.
export function KalenderWithLayers({ events, layers, icsLinks }: KalenderWithLayersProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.key, true])),
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const filteredEvents = useMemo(
    () => events.filter((event) => enabled[event.layer ?? ''] !== false),
    [events, enabled],
  );

  const sortedEvents = useMemo(
    () => [...filteredEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [filteredEvents],
  );

  const showDrone = layers.some((layer) => layer.key === 'drohnengruppe');

  const sidebar = (
    <div className="flex flex-col gap-4 lg:w-64 lg:shrink-0">
      {layers.length > 1 && (
        <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ebenen</span>
          {layers.map((layer) => (
            <ToggleSwitch
              key={layer.key}
              label={layer.label}
              checked={enabled[layer.key] ?? true}
              onChange={(checked) => setEnabled((prev) => ({ ...prev, [layer.key]: checked }))}
            />
          ))}
          {showDrone && (
            <p className="text-xs text-neutral-400">
              Termine der Kategorie Drohnengruppe sind nur für Mitglieder der Drohnengruppe sichtbar.
            </p>
          )}
        </div>
      )}

      <LayerLegend showDrone={showDrone} />

      <div className="rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">ICS Kalender Import</h2>
        <div className="flex flex-col gap-2 text-sm">
          {icsLinks.map((link) => (
            <div key={link.href} className="flex items-center gap-1.5">
              <a href={link.href} className="text-brand hover:underline">
                {link.label}
              </a>
              <CopyLinkButton text={link.copyText} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {sidebar}
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex justify-end">
          <div className="flex rounded-lg bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                viewMode === 'calendar' ? 'bg-brand text-white' : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Kalenderansicht
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                viewMode === 'list' ? 'bg-brand text-white' : 'text-neutral-600 hover:bg-neutral-100'
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
