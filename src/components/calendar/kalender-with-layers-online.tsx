'use client';

import { useRouter } from 'next/navigation';
import { KalenderWithLayers, type CalendarLayer } from './kalender-with-layers';
import { OfflineCacheSync } from './offline-cache-sync';
import type { CalendarEventInput } from './calendar-view';

interface KalenderWithLayersOnlineProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

/**
 * Next.js-spezifischer Adapter für KalenderWithLayers: liefert die echte router.push-Navigation.
 * KalenderWithLayers selbst bleibt dadurch frei von next/navigation und ist so auch von der
 * `/offline-kalender`-Route (über den erweiterten Service Worker, public/sw.js, ausgeliefert)
 * ohne Navigation (readOnly) wiederverwendbar - siehe
 * docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
 */
export function KalenderWithLayersOnline({ events, layers }: KalenderWithLayersOnlineProps) {
  const router = useRouter();
  return (
    <>
      <OfflineCacheSync events={events} layers={layers} />
      <KalenderWithLayers events={events} layers={layers} onNavigate={(path) => router.push(path)} />
    </>
  );
}
