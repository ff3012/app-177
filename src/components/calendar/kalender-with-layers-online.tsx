'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KalenderWithLayers, type CalendarLayer, type SondergruppeOption } from './kalender-with-layers';
import { OfflineCacheSync } from './offline-cache-sync';
import { setSondergruppenFilter } from '@/app/(app)/kalender/sondergruppen-filter-actions';
import type { CalendarEventInput } from './calendar-view';

interface KalenderWithLayersOnlineProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
  sondergruppen?: SondergruppeOption[];
  initialHiddenSondergruppenIds?: string[];
}

/**
 * Next.js-spezifischer Adapter für KalenderWithLayers: liefert die echte router.push-Navigation und
 * die Server-Action-Persistenz der Sondergruppen-Filtereinstellung. KalenderWithLayers selbst bleibt
 * dadurch frei von next/navigation/Server Actions und ist so auch von der `/offline-kalender`-Route
 * (über den erweiterten Service Worker, public/sw.js, ausgeliefert) ohne Navigation/Persistenz
 * (readOnly) wiederverwendbar - siehe docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
 */
export function KalenderWithLayersOnline({
  events,
  layers,
  sondergruppen,
  initialHiddenSondergruppenIds,
}: KalenderWithLayersOnlineProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <>
      <OfflineCacheSync events={events} layers={layers} />
      <KalenderWithLayers
        events={events}
        layers={layers}
        sondergruppen={sondergruppen}
        initialHiddenSondergruppenIds={initialHiddenSondergruppenIds}
        onToggleSondergruppe={(hiddenIds) =>
          startTransition(() => {
            void setSondergruppenFilter(hiddenIds);
          })
        }
        onNavigate={(path) => router.push(path)}
      />
    </>
  );
}
