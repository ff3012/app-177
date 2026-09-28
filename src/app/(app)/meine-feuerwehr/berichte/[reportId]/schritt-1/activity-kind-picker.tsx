'use client';

import { useMemo, useState } from 'react';
import { ACTIVITY_KINDS, type ActivityKindOption } from '@/lib/heimatfeuerwehr/report-constants';

/**
 * Vollbild-Auswahl der Tätigkeitsart (Bericht-Brief.md §5): Suchfeld, "Zuletzt verwendet" (max. 3),
 * darunter alle 39 Codes alphabetisch als Checkbox-Zeilen. Feuerwehrjugend ist eine reine
 * Gruppenüberschrift über ihren 7 Unterpunkten (kein eigener Checkbox-Eintrag, Design-Spec §1 Punkt 7) -
 * daher schließt `filtered` diese 7 Codes aus, solange nicht gesucht wird, damit sie nicht doppelt
 * erscheinen (einmal in der eigenen Sektion, einmal in der alphabetischen Liste); bei aktiver Suche
 * bleiben sie in `filtered` enthalten, damit z.B. "Lager" weiterhin "selbst veranstaltete Lager" findet.
 * "Sonstige" ist ein eigener Freitext-Eintrag, kein ACTIVITY_KINDS-Code - als eigene Checkbox+Textfeld
 * verwaltet (`otherChecked`/`localOther`), nicht Teil der gemeinsamen Checkbox-Liste.
 */
export function ActivityKindPicker({
  selected,
  activityOther,
  recentActivityKinds,
  onDone,
  onClose,
}: {
  selected: string[];
  activityOther: string;
  recentActivityKinds: string[];
  onDone: (nextSelected: string[], nextOther: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(selected);
  const [localOther, setLocalOther] = useState(activityOther);
  const [otherChecked, setOtherChecked] = useState(activityOther.length > 0);

  const sortedAlphabetical = useMemo(
    () => [...ACTIVITY_KINDS].sort((a, b) => a.label.localeCompare(b.label, 'de')),
    [],
  );
  const filtered = useMemo(
    () =>
      sortedAlphabetical.filter(
        (option) =>
          option.label.toLowerCase().includes(search.trim().toLowerCase()) &&
          (search.trim() !== '' || option.group !== 'FEUERWEHRJUGEND'),
      ),
    [sortedAlphabetical, search],
  );
  const recentOptions = useMemo(
    () => recentActivityKinds.map((code) => ACTIVITY_KINDS.find((option) => option.code === code)).filter((o): o is ActivityKindOption => Boolean(o)),
    [recentActivityKinds],
  );

  function toggle(code: string) {
    setLocalSelected((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));
  }

  const totalCount = localSelected.length + (otherChecked && localOther.trim() ? 1 : 0);

  function renderRow(option: ActivityKindOption) {
    const checked = localSelected.includes(option.code);
    return (
      <label key={option.code} className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
        <input type="checkbox" checked={checked} onChange={() => toggle(option.code)} className="h-5 w-5 accent-brand" />
        <span className="text-sm text-[#1c1c1e]">{option.label}</span>
      </label>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 p-4">
        <button type="button" onClick={onClose} className="text-sm font-medium text-neutral-600">
          Abbrechen
        </button>
        <h2 className="text-[15px] font-semibold text-[#1c1c1e]">Tätigkeitsart</h2>
        <button
          type="button"
          onClick={() => onDone(localSelected, otherChecked ? localOther.trim() : '')}
          className="text-sm font-semibold text-brand"
        >
          Fertig · {totalCount}
        </button>
      </div>

      <div className="p-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen …"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {recentOptions.length > 0 && search.trim() === '' && (
          <div className="mb-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Zuletzt verwendet</h3>
            {recentOptions.map(renderRow)}
          </div>
        )}

        <label className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
          <input type="checkbox" checked={otherChecked} onChange={(e) => setOtherChecked(e.target.checked)} className="h-5 w-5 accent-brand" />
          <span className="text-sm text-[#1c1c1e]">Sonstige</span>
        </label>
        {otherChecked && (
          <input
            type="text"
            value={localOther}
            onChange={(e) => setLocalOther(e.target.value)}
            placeholder="Freitext …"
            className="mb-2 mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        )}

        <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Alle Tätigkeitsarten</h3>
        {filtered.map(renderRow)}

        {search.trim() === '' && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Feuerwehrjugend</h3>
            <p className="mb-1 px-1 text-xs text-neutral-400">7 Unterpunkte ›</p>
            {ACTIVITY_KINDS.filter((option) => option.group === 'FEUERWEHRJUGEND').map(renderRow)}
          </div>
        )}
      </div>
    </div>
  );
}
