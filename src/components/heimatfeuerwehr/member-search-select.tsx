'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';

export interface ReportMemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

function memberName(member: ReportMemberOption): string {
  return `${member.lastName} ${member.firstName}`;
}

/**
 * Einzelauswahl-Mitgliedersuche für "Ausfüller ändern" (Bericht-Brief.md §5 Schritt 1) - identisches
 * Popover+Command-Muster wie src/components/admin/org-search-select.tsx, aber über User statt
 * Organization, ohne Abschnitt-Gruppierung (eine Feuerwehr hat keine Unterebenen). Design-Spec §6
 * bestätigt diese neue Such-Combobox anstelle des einfacheren bestehenden <select>-Musters aus
 * booking-form.tsx.
 */
export function MemberSearchSelect({
  members,
  value,
  onChange,
  placeholder,
  id,
}: {
  members: ReportMemberOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => members.find((member) => member.id === value), [members, value]);
  const filtered = useMemo(
    () => members.filter((member) => memberName(member).toLowerCase().includes(search.trim().toLowerCase())),
    [members, search],
  );

  function select(id: string) {
    onChange(id);
    setSearch('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm transition-colors ${
            open ? 'border-2 border-brand px-[11px]' : 'border-neutral-300'
          }`}
        >
          <span className={selected ? 'text-[#1c1c1e]' : 'text-neutral-400'}>
            {selected ? memberName(selected) : placeholder}
          </span>
          <span className="flex-none text-neutral-400">{open ? '▴' : '▾'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[220px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Mitglied suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-neutral-400">Keine Treffer.</div>
            )}
            <CommandGroup>
              {filtered.map((member) => (
                <CommandItem
                  key={member.id}
                  value={member.id}
                  onSelect={() => select(member.id)}
                  className={value === member.id ? 'bg-brand/10 data-[selected=true]:bg-brand/10' : ''}
                >
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
