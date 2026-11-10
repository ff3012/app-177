'use client';

import type { FlightDefaults } from '@/lib/drone/checklist/flight-defaults';

export interface FlightChecklistChoice {
  id: string;
  title: string;
  /** Bereits formatiert: "15.06.2026 10:00 · Lukas Pichler · 1 Flug verknüpft". */
  meta: string;
  status: 'DRAFT' | 'SUBMITTED';
  defaults: FlightDefaults;
}

const BADGE = {
  DRAFT: { label: 'Entwurf', className: 'bg-amber-100 text-amber-900' },
  SUBMITTED: { label: 'Abgeschlossen', className: 'bg-green-100 text-green-900' },
} as const;

/** Karte "Aus Checkliste übernehmen" über dem Flugformular: "Ohne Checkliste" + die letzten Checklisten. */
export function FlightChecklistPicker({
  choices,
  selectedId,
  onSelect,
}: {
  choices: FlightChecklistChoice[];
  selectedId: string;
  onSelect: (choice: FlightChecklistChoice | null) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-card">
      <legend className="sr-only">Aus Checkliste übernehmen</legend>
      <h2 className="text-[15px] font-bold text-ink">Aus Checkliste übernehmen</h2>
      <p className="text-[13px] text-ink-muted">Optional: übernimmt Datum, Uhrzeit, Zweck, Pilot, Ort und Drohne. Alles bleibt änderbar.</p>
      <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${selectedId === '' ? 'border-ink bg-surface-sunken' : 'border-line'}`}>
        <input type="radio" name="checklist-choice" checked={selectedId === ''} onChange={() => onSelect(null)} />
        <span className="text-[15px] font-semibold text-ink">Ohne Checkliste</span>
      </label>
      {choices.map((choice) => (
        <label
          key={choice.id}
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${selectedId === choice.id ? 'border-ink bg-surface-sunken' : 'border-line'}`}
        >
          <input type="radio" name="checklist-choice" checked={selectedId === choice.id} onChange={() => onSelect(choice)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">{choice.title}</span>
            <span className="block truncate text-xs text-ink-muted">{choice.meta}</span>
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[choice.status].className}`}>{BADGE[choice.status].label}</span>
        </label>
      ))}
    </fieldset>
  );
}
