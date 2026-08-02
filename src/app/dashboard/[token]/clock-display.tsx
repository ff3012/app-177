'use client';

import { useEffect, useState } from 'react';

const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
  'November', 'Dezember',
];

/** Client-Insel (nicht die ganze Seite), aktualisiert sich alle 15s selbst - Design-Spec §4/§8. Der
 * Server rendert beim initialen Laden bereits einen Zeitstempel (siehe page.tsx), diese Komponente
 * übernimmt danach die Aktualisierung ohne dass ein Reload der ganzen Seite nötig wäre. */
export function ClockDisplay() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    <div className="flex items-center gap-6">
      <div className="text-right">
        <div className="dash-weekday font-bold leading-none text-[#1c1c1e]">{DAYS[now.getDay()]}</div>
        <div className="dash-secondary mt-2 leading-none text-[#6c6c70]">
          {now.getDate()}. {MONTHS[now.getMonth()]} {now.getFullYear()}
        </div>
      </div>
      <div className="h-[52px] w-px bg-[#e0e0e4]" />
      <div className="dash-clock font-semibold leading-none tracking-[0.01em] text-[#1c1c1e]" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
        {pad(now.getHours())}:{pad(now.getMinutes())}
      </div>
    </div>
  );
}
