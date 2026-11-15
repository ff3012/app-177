'use client';

import { useEffect, useState } from 'react';
import { formatKioskDate, formatKioskTime } from '@/lib/heimatfeuerwehr/kiosk-clock';

/**
 * Kopf der Schnellerfassung: Feuerwehrname (klein, Großbuchstaben), Titel, rechts eine Gerätekarte mit
 * Gerätename (nur wenn gesetzt), Datum und Uhrzeit in Wiener Zeit. Datum und Uhrzeit werden erst nach dem
 * Einhängen im Browser gesetzt (kein Unterschied zwischen Server- und Browser-Rendering) und alle 30 Sekunden
 * aktualisiert.
 */
export function KioskHeader({
  organizationName,
  title,
  deviceName,
}: {
  organizationName: string;
  title: string;
  deviceName: string | null;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="border-b-4 border-brand bg-[#1c1c1e] px-6 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] text-white">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-white/70">{organizationName}</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-4 rounded-xl border border-white/15 bg-white/10 px-4 py-3">
          {deviceName && (
            <div className="border-r border-white/15 pr-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Gerät</p>
              <p className="text-sm font-medium">{deviceName}</p>
            </div>
          )}
          <div className="min-w-[110px] text-right">
            <p className="min-h-[16px] text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">
              {now ? formatKioskDate(now) : ''}
            </p>
            <p className="min-h-[28px] text-[22px] font-bold leading-tight tabular-nums">{now ? formatKioskTime(now) : ''}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
