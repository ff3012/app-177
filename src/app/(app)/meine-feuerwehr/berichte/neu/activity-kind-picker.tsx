'use client';

import { useMemo, useState } from 'react';
import { ACTIVITY_KIND_GROUP_LABEL, type ActivityKindOption } from '@/lib/heimatfeuerwehr/report-constants';

/**
 * Vollbild-Auswahl der Tätigkeits-/Übungsart: Suchfeld, "Zuletzt verwendet" (max. 3), darunter alle
 * Codes alphabetisch als Radio-Zeilen. Bewusst EINZELauswahl (echte HTML-Radios, gemeinsamer `name`) -
 * ein Bericht hat immer genau einen Code ODER "Sonstige", nie mehrere gleichzeitig. "Sonstige" ist
 * deshalb Teil derselben Radio-Gruppe (eigene Zeile mit Freitextfeld darunter) - das Auswählen eines
 * Codes löscht automatisch eine zuvor gewählte "Sonstige" und umgekehrt. `options` bestimmt die
 * Codeliste (ACTIVITY_KINDS für Tätigkeitsbericht, UEBUNGS_ARTEN für Übungsbericht, siehe
 * getKindOptionsForType) - generisch statt fix auf ACTIVITY_KINDS verdrahtet, seit Übungsart dieselbe
 * Komponente mit einer eigenen Zusatzgruppe ("Ausbildungsprüfungen" statt "Feuerwehrjugend")
 * wiederverwendet. Eine `group`-markierte Teilmenge ist eine reine Gruppenüberschrift-Sektion (kein
 * eigener Radio-Eintrag in der alphabetischen Hauptliste) - `filtered` schließt sie aus, solange nicht
 * gesucht wird, damit sie nicht doppelt erscheinen; bei aktiver Suche bleiben sie in `filtered`
 * enthalten, damit z.B. "Lager" weiterhin "selbst veranstaltete Lager" findet.
 */
export function ActivityKindPicker({
  title,
  listLabel,
  options,
  selected,
  activityOther,
  recentActivityKinds,
  onDone,
  onClose,
}: {
  title: string;
  listLabel: string;
  options: ActivityKindOption[];
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

  const sortedAlphabetical = useMemo(() => [...options].sort((a, b) => a.label.localeCompare(b.label, 'de')), [options]);
  const filtered = useMemo(
    () =>
      sortedAlphabetical.filter(
        (option) => option.label.toLowerCase().includes(search.trim().toLowerCase()) && (search.trim() !== '' || !option.group),
      ),
    [sortedAlphabetical, search],
  );
  const recentOptions = useMemo(
    () => recentActivityKinds.map((code) => options.find((option) => option.code === code)).filter((o): o is ActivityKindOption => Boolean(o)),
    [recentActivityKinds, options],
  );
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, ActivityKindOption[]>();
    for (const option of options) {
      if (!option.group) continue;
      const list = groups.get(option.group) ?? [];
      list.push(option);
      groups.set(option.group, list);
    }
    return [...groups.entries()];
  }, [options]);

  function selectCode(code: string) {
    setSelectedCode(code);
    setOtherChecked(false);
  }

  function selectOther() {
    setSelectedCode(null);
    setOtherChecked(true);
  }

  // `name` ist bewusst je Sektion EIGENSTÄNDIG (nicht ein einziges gemeinsames "activityKind" für die
  // ganze Seite, wie ursprünglich) - derselbe Code taucht oft doppelt auf (einmal unter "Zuletzt
  // verwendet", einmal in der Hauptliste/Gruppe). Zwei <input type="radio"> mit demselben `name` UND
  // gleichzeitig identischem Wert lösen bei einem Klick auf die eine Instanz einen nativen
  // Browser-Sync auf die andere aus, der mit Reacts eigener kontrollierter checked-Prop kollidierte -
  // beobachteter Bug: die "Zuletzt verwendet"-Zeile ließ sich nicht anklicken, obwohl der Radio in der
  // Hauptliste für denselben Code korrekt reagierte. Auswahl-Exklusivität kommt ohnehin allein aus
  // `selectedCode` (React State), nie aus nativer name-Gruppierung - pro Sektion einen eigenen `name`
  // zu vergeben behält nur den (rein kosmetischen) Pfeiltasten-Nav-Vorteil innerhalb einer Sektion,
  // ohne das sektionsübergreifende Duplikat-Problem.
  function renderRow(option: ActivityKindOption, sectionName: string) {
    const checked = selectedCode === option.code;
    return (
      <label key={option.code} className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
        <input type="radio" name={sectionName} checked={checked} onChange={() => selectCode(option.code)} className="h-5 w-5 accent-brand" />
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
        <h2 className="text-[15px] font-semibold text-[#1c1c1e]">{title}</h2>
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
            {recentOptions.map((option) => renderRow(option, 'activityKind-recent'))}
          </div>
        )}

        <label className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
          <input type="radio" name="activityKind-other" checked={otherChecked} onChange={selectOther} className="h-5 w-5 accent-brand" />
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

        <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">{listLabel}</h3>
        {filtered.map((option) => renderRow(option, 'activityKind-all'))}

        {search.trim() === '' &&
          groupedOptions.map(([group, groupOptions]) => (
            <div key={group} className="mt-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {ACTIVITY_KIND_GROUP_LABEL[group] ?? group}
              </h3>
              <p className="mb-1 px-1 text-xs text-neutral-400">{groupOptions.length} Unterpunkte ›</p>
              {groupOptions.map((option) => renderRow(option, `activityKind-group-${group}`))}
            </div>
          ))}
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
