'use client';

import type { LucideIcon } from 'lucide-react';
import { Beer, ClipboardList, Siren, Target, TriangleAlert } from 'lucide-react';
import { KIOSK_TILE_HINT, type KioskTile } from '@/lib/heimatfeuerwehr/kiosk-tiles';

const TILE_ICON: Record<KioskTile['key'], LucideIcon> = {
  ACTIVITY: ClipboardList,
  EXERCISE: Target,
  INCIDENT: Siren,
  DRINKS: Beer,
  DAMAGE: TriangleAlert,
};

/**
 * Startbildschirm: eine Kachel je Formular. Aktive Kacheln sind weiß mit Markenrot (App-Stil), gesperrte
 * grau mit Hinweis ("Bald verfügbar" = noch nicht vorhanden, "Nicht aktiviert" = von der Feuerwehr abgeschaltet,
 * "Kein Empfänger hinterlegt" = Meldeformular ohne Empfänger).
 * Alle Kacheln mindestens 120 px hoch.
 */
export function KioskFormScreen({ tiles, onChoose }: { tiles: KioskTile[]; onChoose: (tile: KioskTile) => void }) {
  const anyActive = tiles.some((tile) => tile.state === 'active');
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = TILE_ICON[tile.key];
          const active = tile.state === 'active';
          return (
            <button
              key={tile.key}
              type="button"
              disabled={!active}
              onClick={() => onChoose(tile)}
              className={`flex min-h-[160px] flex-col items-start justify-between rounded-xl border p-5 text-left shadow-sm ${
                active ? 'border-neutral-200 bg-white text-[#1c1c1e]' : 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
              }`}
            >
              <Icon className={`h-10 w-10 ${active ? 'text-brand' : 'text-neutral-300'}`} aria-hidden="true" />
              <span>
                <span className="block text-[22px] font-bold leading-tight">{tile.title}</span>
                <span className={`mt-1 block text-sm ${active ? 'text-[#6c6c70]' : 'text-neutral-400'}`}>{tile.subtitle}</span>
                {!active && (
                  <span className="mt-2 inline-block rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-500">
                    {tile.state !== 'active' && KIOSK_TILE_HINT[tile.state]}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {!anyActive && <p className="mt-6 text-center text-base text-neutral-500">Aktuell ist kein Formular verfügbar.</p>}
    </>
  );
}
