'use client';

import { useMemo, useState } from 'react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { CalendarView, type CalendarEventInput } from './calendar-view';

export interface CalendarLayer {
  key: string;
  label: string;
}

interface KalenderWithLayersProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

export function KalenderWithLayers({ events, layers }: KalenderWithLayersProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.key, true])),
  );

  const filteredEvents = useMemo(
    () => events.filter((event) => enabled[event.layer ?? ''] !== false),
    [events, enabled],
  );

  return (
    <div className="flex flex-col gap-4">
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
      <CalendarView events={filteredEvents} />
    </div>
  );
}
