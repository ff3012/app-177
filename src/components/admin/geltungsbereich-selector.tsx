'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { resolveAdminScope, type AdminScope } from '@/lib/admin/scope';

const STORAGE_KEY = 'admin-scope';
const BEZIRK_LABEL = 'Bezirk 17 St. Pölten';

function scopeToParams(scope: AdminScope): { ebene: string; bereich?: string } {
  if (scope.level === 'BEZIRK') return { ebene: 'bezirk' };
  return { ebene: scope.level === 'ABSCHNITT' ? 'abschnitt' : 'feuerwehr', bereich: scope.organizationId };
}

function scopeLabel(scope: AdminScope): string {
  return scope.level === 'BEZIRK' ? BEZIRK_LABEL : scope.name;
}

/** Benutzerverwaltung-Breite-Brief.md §6: die Kontextzeile bekommt zusätzlich die
 * Mitgliederzahl des aktuellen Geltungsbereichs ("Abschnitt 177 Purkersdorf · 12 Feuerwehren ·
 * 486 Mitglieder") - memberCounts ist optional, damit ein Aufrufer ohne diese Zahl (aktuell keiner
 * mehr, aber die Komponente bleibt auch ohne sie funktionsfähig) nicht crasht. Fehlender Eintrag in
 * der Map bedeutet 0 Mitglieder, nicht "unbekannt" (siehe scope.ts). */
function scopeContextLine(scope: AdminScope, reachable: AdminScope[], memberCounts?: Map<string, number>): string {
  const memberSuffix = (key: string) => {
    if (!memberCounts) return '';
    const count = memberCounts.get(key) ?? 0;
    return ` · ${count} Mitglied${count === 1 ? '' : 'er'}`;
  };
  if (scope.level === 'BEZIRK') {
    const abschnitte = reachable.filter((s) => s.level === 'ABSCHNITT').length;
    const feuerwehren = reachable.filter((s) => s.level === 'FEUERWEHR').length;
    return `${abschnitte} Abschnitte · ${feuerwehren} Feuerwehren${memberSuffix('BEZIRK')}`;
  }
  if (scope.level === 'ABSCHNITT') {
    const feuerwehren = reachable.filter(
      (s) => s.level === 'FEUERWEHR' && s.abschnittOrganizationId === scope.organizationId,
    ).length;
    return `${feuerwehren} Feuerwehr${feuerwehren === 1 ? '' : 'en'}${memberSuffix(scope.organizationId)}`;
  }
  return memberSuffix(scope.organizationId).replace(/^ · /, '');
}

function isSameScope(a: AdminScope, b: AdminScope): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 'BEZIRK') return true;
  return (a as { organizationId: string }).organizationId === (b as { organizationId: string }).organizationId;
}

function GeltungsbereichSelectorInner({
  reachable,
  memberCounts,
}: {
  reachable: AdminScope[];
  memberCounts?: Map<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const rawEbene = searchParams.get('ebene') ?? undefined;
  const rawOrg = searchParams.get('bereich') ?? undefined;
  const { scope: current } = useMemo(
    () => resolveAdminScope(reachable, rawEbene, rawOrg),
    [reachable, rawEbene, rawOrg],
  );

  function navigateTo(scope: AdminScope, options?: { replace?: boolean }) {
    const params = new URLSearchParams(searchParams.toString());
    const next = scopeToParams(scope);
    params.set('ebene', next.ebene);
    if (next.bereich) {
      params.set('bereich', next.bereich);
    } else {
      params.delete('bereich');
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    const url = `${pathname}?${params.toString()}`;
    if (options?.replace) {
      router.replace(url);
    } else {
      router.push(url);
    }
    setOpen(false);
  }

  // Erststart ohne Parameter: zuletzt gewählte Ebene aus localStorage übernehmen, falls noch
  // erreichbar - stellt eine kanonische, teilbare URL her, statt den impliziten Fallback (erster
  // Eintrag von resolveAdminScope) nur unsichtbar im Hintergrund zu verwenden. Der Wähler ist
  // zweimal pro Seite gemountet (Desktop-Sidebar + mobiler Seiten-Wrapper), daher `router.replace`
  // statt `router.push` hier - eine echte Nutzerauswahl (siehe onSelect unten) bleibt push, da sie
  // in der Browser-History landen soll, diese stille Kanonisierung nicht. reachable.length <= 1
  // wird zusätzlich vor jedem localStorage-Zugriff geprüft, da ein reiner Drohnengruppen-/
  // Bezirks-Drohnenadmin ganz ohne Organisations-Admin-Recht ein leeres reachable-Array haben kann -
  // resolveAdminScope's Fallback wäre dann undefined, und navigateTo(undefined) würde in
  // scopeToParams werfen.
  useEffect(() => {
    if (reachable.length <= 1) return;
    if (rawEbene) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as { ebene?: string; bereich?: string };
      const resolved = resolveAdminScope(reachable, stored.ebene, stored.bereich);
      if (!resolved.requestedButUnreachable) {
        navigateTo(resolved.scope, { replace: true });
      }
    } catch {
      // Ungültiger localStorage-Inhalt - der bestehende Fallback bleibt einfach bestehen.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reachable.length <= 1) {
    return null;
  }

  const bezirk = reachable.find((s) => s.level === 'BEZIRK');
  const abschnitte = reachable.filter((s): s is Extract<AdminScope, { level: 'ABSCHNITT' }> => s.level === 'ABSCHNITT');
  const feuerwehren = reachable.filter((s): s is Extract<AdminScope, { level: 'FEUERWEHR' }> => s.level === 'FEUERWEHR');

  const query = search.trim().toLowerCase();
  const bezirkMatches = Boolean(bezirk) && BEZIRK_LABEL.toLowerCase().includes(query);
  const filteredAbschnitte = abschnitte.filter((s) => s.name.toLowerCase().includes(query));
  const filteredFeuerwehren = feuerwehren.filter((s) => s.name.toLowerCase().includes(query));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[58px] w-full flex-col items-start justify-center border-b border-line bg-surface px-3.5 text-left hover:bg-surface-sunken"
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">{scopeLabel(current)}</span>
            <span aria-hidden className="text-ink-faint">
              {open ? '▴' : '▾'}
            </span>
          </span>
          <span className="text-[13px] text-ink-faint">{scopeContextLine(current, reachable, memberCounts)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-0 shadow-[0_10px_28px_rgba(28,28,30,.14)]">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty className="py-4 text-sm text-ink-faint">Keine Treffer.</CommandEmpty>
            {bezirk && bezirkMatches && (
              <CommandGroup>
                <CommandItem
                  value="__bezirk__"
                  onSelect={() => navigateTo(bezirk)}
                  className={isSameScope(current, bezirk) ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}
                >
                  {BEZIRK_LABEL}
                </CommandItem>
              </CommandGroup>
            )}
            {filteredAbschnitte.length > 0 && (
              <CommandGroup heading="Abschnitte">
                {filteredAbschnitte.map((scope) => (
                  <CommandItem
                    key={scope.organizationId}
                    value={scope.organizationId}
                    onSelect={() => navigateTo(scope)}
                    className={`pl-6 ${isSameScope(current, scope) ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}`}
                  >
                    {scope.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredFeuerwehren.length > 0 && (
              <CommandGroup heading="Feuerwehren">
                {filteredFeuerwehren.map((scope) => (
                  <CommandItem
                    key={scope.organizationId}
                    value={scope.organizationId}
                    onSelect={() => navigateTo(scope)}
                    className={`pl-6 ${isSameScope(current, scope) ? 'bg-brand-subtle data-[selected=true]:bg-brand-subtle' : ''}`}
                  >
                    {scope.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * useSearchParams() braucht laut Next.js einen Suspense-Grenzwert. Jede andere URL-Sync-Komponente
 * in dieser Codebase (z. B. user-management-section.tsx) bekommt ihren Anfangswert stattdessen als
 * Prop von einer page.tsx, die searchParams selbst liest - das geht hier nicht, da AdminSidebar vom
 * Layout gerendert wird, das gar kein searchParams erhält (siehe Design-Spec §2). Der
 * Suspense-Wrapper lebt hier, nicht bei jedem Aufrufer, damit niemand vergisst, ihn zu setzen.
 */
export function GeltungsbereichSelector({
  reachable,
  memberCounts,
}: {
  reachable: AdminScope[];
  memberCounts?: Map<string, number>;
}) {
  return (
    <Suspense fallback={<div className="h-[58px] border-b border-line" />}>
      <GeltungsbereichSelectorInner reachable={reachable} memberCounts={memberCounts} />
    </Suspense>
  );
}
