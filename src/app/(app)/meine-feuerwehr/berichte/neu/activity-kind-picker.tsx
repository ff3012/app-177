'use client';

import { useMemo, useState } from 'react';
import { ACTIVITY_KINDS, type ActivityKindOption } from '@/lib/heimatfeuerwehr/report-constants';

/**
 * Vollbild-Auswahl der Tätigkeitsart: Suchfeld, "Zuletzt verwendet" (max. 3), darunter alle 39 Codes
 * alphabetisch als Radio-Zeilen. Bewusst EINZELauswahl (echte HTML-Radios, gemeinsamer `name`) - ein
 * Bericht hat immer genau eine Tätigkeitsart ODER "Sonstige", nie mehrere gleichzeitig. "Sonstige" ist
 * deshalb Teil derselben Radio-Gruppe (eigene Zeile mit Freitextfeld darunter) - das Auswählen eines
 * Codes löscht automatisch eine zuvor gewählte "Sonstige" und umgekehrt. Feuerwehrjugend ist eine reine
 * Gruppenüberschrift über ihren 7 Unterpunkten (kein eigener Radio-Eintrag) - daher schließt `filtered`
 * diese 7 Codes aus, solange nicht gesucht wird, damit sie nicht doppelt erscheinen (einmal in der
 * eigenen Sektion, einmal in der alphabetischen Liste); bei aktiver Suche bleiben sie in `filtered`
 * enthalten, damit z.B. "Lager" weiterhin "selbst veranstaltete Lager" findet.
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
  const [selectedCode, setSelectedCode] = useState<string | null>(selected[0] ?? null);
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

  function selectCode(code: string) {
    setSelectedCode(code);
    setOtherChecked(false);
  }

  function selectOther() {
    setSelectedCode(null);
    setOtherChecked(true);
  }

  function renderRow(option: ActivityKindOption) {
    const checked = selectedCode === option.code;
    return (
      <label key={option.code} className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
        <input type="radio" name="activityKind" checked={checked} onChange={() => selectCode(option.code)} className="h-5 w-5 accent-brand" />
        <span className="text-sm text-[#1c1c1e]">{option.label}</span>
      </label>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* pt-safe: dieses Overlay liegt außerhalb von (app)/layout.tsx's Kopfzeile/Chrome (eigenes
          fixed inset-0), bekommt dessen üblichen Abstand zur Notch/Statusleiste also nicht
          automatisch mit - ohne pt-safe rendert die Kopfzeile (inkl. "Abbrechen") auf einem iPhone
          teils hinter der Statusleiste/Dynamic Island (realer Nutzerbericht). */}
      <div className="pt-safe flex items-center justify-between border-b border-neutral-200 px-4 pb-4">
        <button type="button" onClick={onClose} className="text-sm font-medium text-neutral-600">
          Abbrechen
        </button>
        <h2 className="text-[15px] font-semibold text-[#1c1c1e]">Tätigkeitsart</h2>
        <span className="w-[52px]" />
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

      {/* "Fertig" ist eine eigene, fixe Leiste unten (wie "Weiter"/"Bericht abgeben" im Assistenten)
          statt eines Buttons in der oberen Kopfzeile - auf einem iPhone war die Kopfzeile teils hinter
          der Statusleiste verdeckt, wodurch "Fertig" nicht antippbar war. Der scrollbare Listenbereich
          bekommt entsprechend zusätzlichen unteren Abstand (pb-24), damit die letzten Zeilen nicht
          hinter dieser Leiste verschwinden. */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {recentOptions.length > 0 && search.trim() === '' && (
          <div className="mb-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Zuletzt verwendet</h3>
            {recentOptions.map(renderRow)}
          </div>
        )}

        <label className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
          <input type="radio" name="activityKind" checked={otherChecked} onChange={selectOther} className="h-5 w-5 accent-brand" />
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

      <div className="pb-safe-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
        <button
          type="button"
          onClick={() => onDone(selectedCode ? [selectedCode] : [], otherChecked ? localOther.trim() : '')}
          className="flex h-[52px] w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white"
        >
          Fertig
        </button>
      </div>
    </div>
  );
}
