'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { CalendarEventInput } from './calendar-view';
import type { CalendarLayer } from './kalender-with-layers';

const CACHE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_DIR_PATH = 'offline-cache';
const CACHE_FILE_PATH = `${CACHE_DIR_PATH}/kalender.json`;

export interface OfflineKalenderCache {
  syncedAt: string;
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

interface OfflineCacheSyncProps {
  events: CalendarEventInput[];
  layers: CalendarLayer[];
}

/**
 * Android-only, best-effort: schreibt bei jedem normalen Online-Besuch der Kalender-Seite einen
 * lokalen JSON-Snapshot (letzte 30 Tage + alle zukünftigen Termine, gefiltert nach `end`, nicht
 * `start` - ein mehrtägiger Termin, der vor 40 Tagen begann und erst morgen endet, bleibt so im
 * Cache), den die Offline-Ansicht (`/offline-kalender`, eine ganz normale Next.js-Route, ausgeliefert
 * über den erweiterten Service Worker in public/sw.js) später liest. Ein Fehler hier darf die normale
 * Online-Anzeige nie beeinträchtigen - siehe
 * docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
 */
export function OfflineCacheSync({ events, layers }: OfflineCacheSyncProps) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    async function writeCache() {
      try {
        const cutoff = Date.now() - CACHE_WINDOW_MS;
        const cachedEvents = events.filter((event) => new Date(event.end).getTime() >= cutoff);
        const cache: OfflineKalenderCache = {
          syncedAt: new Date().toISOString(),
          events: cachedEvents,
          layers,
        };

        try {
          await Filesystem.mkdir({ path: CACHE_DIR_PATH, directory: Directory.Data, recursive: true });
        } catch {
          // recursive:true deckt "existiert schon" bereits ab - hier nur zusätzliches Sicherheitsnetz.
        }

        await Filesystem.writeFile({
          path: CACHE_FILE_PATH,
          data: JSON.stringify(cache),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
      } catch (err) {
        console.error('Offline-Kalender-Cache konnte nicht geschrieben werden:', err);
      }
    }

    writeCache();
  }, [events, layers]);

  return null;
}
