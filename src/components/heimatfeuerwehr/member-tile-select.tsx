'use client';

import { useMemo, useState } from 'react';
import type { ReportMemberOption } from './member-search-select';

function memberName(member: ReportMemberOption): string {
  return `${member.lastName} ${member.firstName}`;
}

/** Reine Filterlogik: ohne bereits eingetragene Mitglieder, Suche in "Nachname Vorname". */
export function filterSelectableMembers(
  members: ReportMemberOption[],
  excludeIds: string[],
  search: string,
): ReportMemberOption[] {
  const needle = search.trim().toLowerCase();
  return members.filter((member) => !excludeIds.includes(member.id) && memberName(member).toLowerCase().includes(needle));
}

/**
 * Tablet-Variante von MemberMultiSelect (gleiche Schnittstelle): statt eines Popovers öffnet sich ein
 * Vollbild-Blatt mit großen Namenskacheln. Antippen wählt an/ab, "Fertig" bestätigt die ganze Auswahl
 * auf einmal (`onAdd` bekommt nur die neu gewählten Ids). Alle Tipp-Ziele mindestens 48 px.
 */
export function MemberTileSelect({
  members,
  excludeIds,
  onAdd,
  placeholder,
}: {
  members: ReportMemberOption[];
  excludeIds: string[];
  onAdd: (ids: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string[]>([]);

  const available = useMemo(() => filterSelectableMembers(members, excludeIds, search), [members, excludeIds, search]);

  function toggle(id: string) {
    setPending((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function close() {
    setPending([]);
    setSearch('');
    setOpen(false);
  }
  function commit() {
    if (pending.length > 0) onAdd(pending);
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[48px] items-center rounded-lg border border-dashed border-brand px-4 text-[15px] font-medium text-brand"
      >
        + {placeholder}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={placeholder}>
          <div className="flex items-center gap-3 border-b border-neutral-200 p-4">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Mitglied suchen …"
              className="min-h-[48px] flex-1 rounded-lg border border-neutral-300 px-4 text-base"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {available.length === 0 ? (
              <p className="py-8 text-center text-base text-neutral-400">Keine Treffer.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {available.map((member) => {
                  const checked = pending.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggle(member.id)}
                      className={`min-h-[56px] rounded-lg border px-3 py-2 text-left text-[15px] font-semibold ${
                        checked ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'
                      }`}
                    >
                      {checked ? '✓ ' : ''}
                      {memberName(member)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-neutral-200 p-4">
            <button type="button" onClick={close} className="min-h-[52px] rounded-lg border border-neutral-300 px-6 text-[15px] font-semibold">
              Abbrechen
            </button>
            <button type="button" onClick={commit} className="min-h-[52px] rounded-lg bg-brand px-8 text-[15px] font-semibold text-white">
              Fertig ({pending.length})
            </button>
          </div>
        </div>
      )}
    </>
  );
}
