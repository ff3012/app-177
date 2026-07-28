'use client';

import { useMemo, useState } from 'react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { CalendarView, type CalendarEventInput } from './calendar-view';
import { EventListView } from './event-list-view';

export interface CalendarLayer {
  key: string;
  label: string;
}

interface KalenderWithLayersProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

type ViewMode = 'calendar' | 'list';

export function KalenderWithLayers({ events, layers }: KalenderWithLayersProps) {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {layers.length > 1 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-white p-3 shadow-sm">
            {layers.map((layer) => (
              <ToggleSwitch
                key={layer.key}
                label={layer.label}
                checked={enabled[layer.key] ?? true}
                onChange={(checked) => setEnabled((prev) => ({ ...prev, [layer.key]: checked }))}
              />
            ))}
          </div>
        )}
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
  );
}
