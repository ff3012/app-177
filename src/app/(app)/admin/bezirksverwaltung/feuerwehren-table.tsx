'use client';

import { useMemo, useState } from 'react';
import type { FeuerwehrKategorie } from '@prisma/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FEUERWEHR_KATEGORIE_LABEL } from '@/lib/organizations/feuerwehr-kategorie';
import { RenameFeuerwehrForm } from './rename-feuerwehr-form';
import { AddFeuerwehrForm } from './add-feuerwehr-form';
import { toggleFeuerwehrActive, toggleFeuerwehrKategorie } from './actions';

export interface FeuerwehrRow {
  id: string;
  name: string;
  shortName: string | null;
  nummer: string;
  abschnittName: string;
  isActive: boolean;
  feuerwehrKategorie: FeuerwehrKategorie;
}

/** Freitext-Suchfeld analog zur Benutzertabelle (bei 124 Feuerwehren rechtfertigt sich das) - rein
 * clientseitig über den bereits serverseitig geladenen, vollständigen FeuerwehrRow[]-Array, kein
 * Server-Roundtrip pro Tastenanschlag, gleiches Muster wie UserManagementSection. */
export function FeuerwehrenTable({ feuerwehren, abschnitte }: { feuerwehren: FeuerwehrRow[]; abschnitte: { id: string; name: string }[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return feuerwehren;
    return feuerwehren.filter(
      (f) => f.name.toLowerCase().includes(q) || (f.shortName ?? '').toLowerCase().includes(q) || f.nummer.includes(q),
    );
  }, [feuerwehren, search]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Feuerwehr suchen …"
        className="w-full max-w-sm rounded-md border border-line px-3 py-2 text-sm"
      />
      <Table>
        <TableHeader>
          <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name / Kurzname</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Nummer</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Abschnitt</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Kategorie</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((f) => {
            const boundToggle = toggleFeuerwehrActive.bind(null, f.id);
            const boundToggleKategorie = toggleFeuerwehrKategorie.bind(null, f.id);
            return (
              <TableRow key={f.id} className="border-line">
                <TableCell>
                  <RenameFeuerwehrForm organizationId={f.id} currentName={f.name} currentShortName={f.shortName ?? ''} />
                </TableCell>
                <TableCell className="font-mono text-ink-muted">{f.nummer}</TableCell>
                <TableCell className="text-ink-muted">{f.abschnittName}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-transparent bg-brand-subtle text-ink">
                      {FEUERWEHR_KATEGORIE_LABEL[f.feuerwehrKategorie]}
                    </Badge>
                    <form action={boundToggleKategorie}>
                      <button type="submit" className="text-xs text-brand hover:underline">
                        {f.feuerwehrKategorie === 'FREIWILLIGE_FEUERWEHR' ? 'Auf Betriebsfeuerwehr setzen' : 'Auf Freiwillige Feuerwehr setzen'}
                      </button>
                    </form>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={f.isActive ? 'border-transparent bg-success-subtle text-success-text' : 'border-transparent bg-danger-subtle text-danger'}
                  >
                    {f.isActive ? 'Aktiv' : 'Deaktiviert'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <form action={boundToggle}>
                    <button type="submit" className="text-sm text-brand hover:underline">
                      {f.isActive ? 'Deaktivieren' : 'Reaktivieren'}
                    </button>
                  </form>
                </TableCell>
              </TableRow>
            );
          })}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-ink-muted">
                Keine Feuerwehr entspricht der Suche.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <AddFeuerwehrForm abschnitte={abschnitte} />
    </div>
  );
}
