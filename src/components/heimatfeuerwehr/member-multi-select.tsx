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
 * Popover+Command-Muster wie MemberSearchSelect, aber value/onChange als string[] statt string. Zeigt
 * bereits ausgewählte Mitglieder als abhakbare Zeilen (kein Entfernen hier - das übernimmt die
 * Mitgliederliste in Schritt 2 selbst, diese Komponente fügt nur hinzu).
 */
export function MemberMultiSelect({
  members,
  value,
  onChange,
  placeholder,
}: {
  members: ReportMemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const available = useMemo(() => members.filter((member) => !value.includes(member.id)), [members, value]);
  const filtered = useMemo(
    () => available.filter((member) => memberName(member).toLowerCase().includes(search.trim().toLowerCase())),
    [available, search],
  );

  function add(id: string) {
    onChange([...value, id]);
    setSearch('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 text-sm font-medium text-brand"
        >
          + {placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Mitglied suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-neutral-400">Keine Treffer.</div>
            )}
            <CommandGroup>
              {filtered.map((member) => (
                <CommandItem key={member.id} value={member.id} onSelect={() => add(member.id)}>
                  {memberName(member)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
