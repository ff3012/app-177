'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';
import { groupByAbschnitt } from '@/lib/admin/group-by-abschnitt';

export interface OrgSearchSelectOption {
  id: string;
  name: string;
  abschnittName?: string;
}

/**
 * Einzelauswahl-Geschwister von AdminOrgMultiSelect - gleiche Popover+Command-Bauweise, gleiches
 * "nach Abschnitt gruppiert"-Verhalten, aber ein einzelner gewählter Wert statt eines Arrays.
 * Geschlossen zeigt der Trigger entweder den gewählten Namen oder `allLabel` (z. B. "Alle
 * Feuerwehren") - anders als AdminOrgMultiSelects "N von M ausgewählt", da hier höchstens ein
 * Eintrag gewählt sein kann.
 */
export function OrgSearchSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  allValue = 'ALLE',
}: {
  options: OrgSearchSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  allLabel: string;
  allValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => options.find((org) => org.id === value), [options, value]);
  const hasAbschnittGroups = options.some((org) => Boolean(org.abschnittName));
  const filteredOptions = useMemo(
    () => options.filter((org) => org.name.toLowerCase().includes(search.trim().toLowerCase())),
    [options, search],
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
          type="button"
          className={`flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-sm transition-colors ${
            open ? 'border-2 border-brand px-[11px]' : 'border-line'
          }`}
        >
          <span className={selected ? 'text-ink' : 'text-ink-faint'}>{selected ? selected.name : allLabel}</span>
          <span className="flex-none text-ink-faint">{open ? '▴' : '▾'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[220px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`${placeholder} suchen …`} value={search} onValueChange={setSearch} />
          <CommandList>
            {filteredOptions.length === 0 && (
              <div className="py-4 text-center text-sm text-ink-faint">Keine Treffer.</div>
            )}
            <CommandGroup>
              <CommandItem
                value={allValue}
                onSelect={() => select(allValue)}
                className={value === allValue ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
              >
                {allLabel}
              </CommandItem>
            </CommandGroup>
            {Object.entries(groupByAbschnitt(filteredOptions)).map(([abschnittName, orgs]) => (
              <CommandGroup key={abschnittName} heading={hasAbschnittGroups ? abschnittName : undefined}>
                {orgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={org.id}
                    onSelect={() => select(org.id)}
                    className={value === org.id ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                  >
                    {org.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
