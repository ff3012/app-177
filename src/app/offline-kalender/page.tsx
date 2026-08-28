'use client';

import { useEffect, useState } from 'react';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { KalenderWithLayers } from '@/components/calendar/kalender-with-layers';
import { MobileHeaderProvider, useMobileHeader } from '@/components/layout/mobile-header-context';
import type { OfflineKalenderCache } from '@/components/calendar/offline-cache-sync';

const CACHE_FILE_PATH = 'offline-cache/kalender.json';

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; cache: OfflineKalenderCache };

function useOfflineCache(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await Filesystem.readFile({
          path: CACHE_FILE_PATH,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        const cache = JSON.parse(result.data as string) as OfflineKalenderCache;
        if (cancelled) return;
        if (Array.isArray(cache.events) && Array.isArray(cache.layers)) {
          setState({ status: 'ready', cache });
        } else {
          setState({ status: 'empty' });
        }
      } catch (err) {
        // Datei fehlt (nie online synchronisiert), ist beschädigt, oder JSON.parse schlägt fehl -
        // in allen Fällen dieselbe "kein Cache"-Meldung statt eines Absturzes. console.error bleibt
        // für Logcat-Sichtbarkeit beim Debuggen auf einem echten Gerät erhalten (Finding aus dem
        // vorherigen Task-4-Review: ein leerer catch{} macht "nie synchronisiert" von "Cache
        // beschädigt" nicht mehr unterscheidbar).
        console.error('Offline-Kalender-Cache konnte nicht gelesen werden:', err);
        if (!cancelled) setState({ status: 'empty' });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
}

function reload() {
  // Lädt dieselbe URL neu - kommt der Request diesmal durch (Netz wieder da), liefert der
  // Service Worker die echte, live gerenderte Seite statt der gecachten Offline-Antwort.
  window.location.reload();
}

function OfflineHeader({ syncedAt }: { syncedAt: string | null }) {
  const { actionSlot } = useMobileHeader();
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-200 bg-[#1c1c1e] px-4 py-3 pt-safe text-white">
      <div className="flex flex-col">
        <span className="text-sm font-semibold">Offline-Ansicht</span>
        {syncedAt && <span className="text-xs text-neutral-300">Stand: {formatSyncedAt(syncedAt)}</span>}
      </div>
      <div className="flex items-center gap-2">
        {actionSlot}
        <button
          type="button"
          onClick={reload}
          className="rounded bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
        >
          Erneut verbinden
        </button>
      </div>
    </div>
  );
}

function OfflineKalenderContent() {
  const state = useOfflineCache();

  if (state.status === 'loading') {
    return (
      <>
        <OfflineHeader syncedAt={null} />
        <div className="p-4 text-sm text-neutral-500">Lädt…</div>
      </>
    );
  }

  if (state.status === 'empty') {
    return (
      <>
        <OfflineHeader syncedAt={null} />
        <div className="p-4">
          <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
            Noch keine Daten zwischengespeichert — bitte einmal mit Internetverbindung öffnen.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <OfflineHeader syncedAt={state.cache.syncedAt} />
      <div className="p-4">
        <KalenderWithLayers events={state.cache.events} layers={state.cache.layers} readOnly />
      </div>
    </>
  );
}

export default function OfflineKalenderPage() {
  return (
    <MobileHeaderProvider>
      <div className="min-h-screen bg-[#f6f6f7]">
        <OfflineKalenderContent />
      </div>
    </MobileHeaderProvider>
  );
}
