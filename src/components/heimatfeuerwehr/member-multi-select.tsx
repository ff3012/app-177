'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';
import type { ReportMemberOption } from './member-search-select';

export type { ReportMemberOption };

function memberName(member: ReportMemberOption): string {
  return `${member.lastName} ${member.firstName}`;
}

/**
 * Mehrfachauswahl-Mitgliedersuche für "+ Mitglied hinzufügen" (Bericht-Brief.md §5 Schritt 2) - gleiches
 * Popover+Command-Muster wie MemberSearchSelect. Anders als eine reine "Klick fügt hinzu und schließt"-
 * Auswahl (das ursprüngliche Verhalten, das für mehrere Mitglieder mühsam war - Popover mehrfach neu
 * öffnen) bleibt das Popover beim Anhaken offen: jede Zeile ist eine abhakbare Checkbox, "Fertig"
 * bestätigt die ganze Auswahl auf einmal. `excludeIds` sind Mitglieder, die in KEINER der (ggf.
 * mehreren, z. B. pro Fahrzeug) Instanzen dieser Komponente mehr auswählbar sein sollen - i. d. R. alle
 * bereits irgendwo im Bericht eingetragenen Mitglieder, nicht nur die dieser einen Instanz/Gruppe.
 * `onAdd` bekommt ausschließlich die NEU ausgewählten IDs dieser Session (nicht den gemergten
 * Gesamtwert) - der Aufrufer entscheidet, welcher Gruppe/welchem Fahrzeug sie zugeordnet werden.
 */
export function MemberMultiSelect({
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

  const available = useMemo(() => members.filter((member) => !excludeIds.includes(member.id)), [members, excludeIds]);
  const filtered = useMemo(
    () => available.filter((member) => memberName(member).toLowerCase().includes(search.trim().toLowerCase())),
    [available, search],
  );

  function toggle(id: string) {
    setPending((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function commit() {
    if (pending.length > 0) onAdd(pending);
    setPending([]);
    setSearch('');
    setOpen(false);
  }
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPending([]);
      setSearch('');
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 text-sm font-medium text-brand"
        >
          + {placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Mitglied suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-neutral-400">Keine Treffer.</div>
            )}
            <CommandGroup>
              {filtered.map((member) => {
                const checked = pending.includes(member.id);
                return (
                  <CommandItem key={member.id} value={member.id} onSelect={() => toggle(member.id)}>
                    <span
                      className={`mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
                        checked ? 'border-brand bg-brand text-white' : 'border-neutral-300'
                      }`}
                    >
                      {checked ? '✓' : ''}
                    </span>
                    {memberName(member)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t border-neutral-100 p-2">
          <span className="text-xs text-neutral-400">{pending.length} ausgewählt</span>
          <button
            type="button"
            onClick={commit}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white"
          >
            Fertig
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
