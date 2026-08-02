'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';

interface OrgOption {
  id: string;
  name: string;
}

/**
 * "Admin für" als Mehrfachauswahl (Benutzerverwaltung-Brief.md §4) - ersetzt die frühere
 * zehnzeilige Checkbox-Liste im Scrollfluss durch ein Popover+Command-Kombinationsfeld:
 * geschlossen ein Chip-Feld mit Platzhalter, offen eine durchsuchbare Liste mit
 * Status-/Leeren-Zeile. Der eigene Checkbox-Look (links, quadratisch) statt cmdk's eingebautem
 * rechtem Häkchen, da das Mockup Checkboxen links zeigt - cmdk's Item bleibt trotzdem für die
 * Tastatur-Navigation/Suche zuständig, der Haken-Status kommt aus dem eigenen value-Array, nicht
 * aus cmdk's data-selected (das ist nur "gerade per Pfeiltaste hervorgehoben", nicht "ausgewählt").
 */
export function AdminOrgMultiSelect({
  organizations,
  value,
  onChange,
}: {
  organizations: OrgOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedOrgs = useMemo(
    () => organizations.filter((org) => value.includes(org.id)),
    [organizations, value],
  );

  function toggle(orgId: string) {
    onChange(value.includes(orgId) ? value.filter((id) => id !== orgId) : [...value, orgId]);
  }

  function remove(orgId: string) {
    onChange(value.filter((id) => id !== orgId));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex min-h-[42px] w-full items-center justify-between gap-2.5 rounded-md border bg-transparent px-3 py-1.5 text-left transition-colors ${
            open ? 'border-2 border-brand px-[11px] py-[5px]' : 'border-line'
          }`}
        >
          {selectedOrgs.length > 0 ? (
            <span className="flex flex-1 flex-wrap gap-1.5">
              {selectedOrgs.map((org) => (
                <span
                  key={org.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle py-1 pl-2.5 pr-1.5 text-[13px] font-medium text-brand-hover"
                >
                  {org.name}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(org.id);
                    }}
                    className="cursor-pointer text-[14px] leading-none text-brand-hover/60 hover:text-brand-hover"
                    aria-label={`${org.name} entfernen`}
                  >
                    ×
                  </span>
                </span>
              ))}
            </span>
          ) : (
            <span className="flex-1 text-[15px] text-ink-faint">Keine Adminrechte</span>
          )}
          <span className="flex-none text-ink-faint">{open ? '▴' : '▾'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Feuerwehr suchen …"
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && search === '' && selectedOrgs.length > 0) {
                remove(selectedOrgs[selectedOrgs.length - 1].id);
              }
            }}
          />
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <span className="text-[13px] font-medium text-ink-muted">
              {value.length} von {organizations.length} ausgewählt
            </span>
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[13px] font-medium text-danger hover:underline"
              >
                Auswahl leeren
              </button>
            )}
          </div>
          <CommandList>
            <CommandEmpty className="py-4 text-sm text-ink-faint">Keine Feuerwehr gefunden.</CommandEmpty>
            {organizations
              .filter((org) => org.name.toLowerCase().includes(search.trim().toLowerCase()))
              .map((org) => {
                const checked = value.includes(org.id);
                return (
                  <CommandItem
                    key={org.id}
                    value={org.name}
                    onSelect={() => toggle(org.id)}
                    className={checked ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                  >
                    <span
                      className={`flex size-[19px] flex-none items-center justify-center rounded ${
                        checked ? 'bg-brand text-white' : 'border-[1.5px] border-line-strong'
                      }`}
                      aria-hidden
                    >
                      {checked && (
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="text-[15px] text-ink">{org.name}</span>
                  </CommandItem>
                );
              })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
