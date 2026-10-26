'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import type { MemberAusbildung } from '@/lib/drone/einsatzbereitschaft';
import { MobileSortControl, SortableHead, compareText, compareValues, useSort } from './sortable';

type StufeKey = 'a1a3LizenzAm' | 'a2LizenzAm' | 'stuetzpunktausbildungAm' | 'bos1AusbildungAm' | 'bos2AusbildungAm';

const STUFEN: { key: StufeKey; label: string }[] = [
  { key: 'a1a3LizenzAm', label: 'A1/A3' },
  { key: 'a2LizenzAm', label: 'A2' },
  { key: 'stuetzpunktausbildungAm', label: 'Stützpunktausbildung' },
  { key: 'bos1AusbildungAm', label: 'BOS1' },
  { key: 'bos2AusbildungAm', label: 'BOS2' },
];

/** Filterwert: "ALLE", "KEINE" (noch keine einzige Stufe) oder "hat:<key>"/"fehlt:<key>". */
const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALLE', label: 'Alle Mitglieder' },
  { value: 'KEINE', label: 'Ohne jede Ausbildung' },
  ...STUFEN.map((s) => ({ value: `hat:${s.key}`, label: `Hat ${s.label}` })),
  ...STUFEN.map((s) => ({ value: `fehlt:${s.key}`, label: `Fehlt ${s.label}` })),
];

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function matchesFilter(member: MemberAusbildung, filter: string): boolean {
  if (filter === 'ALLE') return true;
  if (filter === 'KEINE') return STUFEN.every((s) => member[s.key] === null);
  const [mode, key] = filter.split(':') as ['hat' | 'fehlt', StufeKey];
  return mode === 'hat' ? member[key] !== null : member[key] === null;
}

function MemberName({ member, canLinkToUser }: { member: MemberAusbildung; canLinkToUser: boolean }) {
  if (!canLinkToUser) return <>{member.name}</>;
  return (
    <Link href={`/admin/benutzer?edit=${member.id}`} className="hover:underline">
      {member.name}
    </Link>
  );
}

type SortKey = 'name' | 'feuerwehr' | StufeKey;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'feuerwehr', label: 'Feuerwehr' },
  ...STUFEN.map((s) => ({ key: s.key as SortKey, label: s.label })),
];

export function AusbildungTable({ members, canLinkToUser }: { members: MemberAusbildung[]; canLinkToUser: boolean }) {
  const [filter, setFilter] = useState('ALLE');
  const sort = useSort<SortKey>('name');
  const filtered = useMemo(() => {
    const matching = members.filter((m) => matchesFilter(m, filter));
    return matching.sort((a, b) => {
      if (sort.key === 'name') return compareValues(a.name, b.name, sort.dir, compareText);
      if (sort.key === 'feuerwehr') return compareValues(a.feuerwehr, b.feuerwehr, sort.dir, compareText);
      // ISO-Datum "YYYY-MM-DD" sortiert als Text chronologisch; fehlende Stufen bleiben am Ende.
      return compareValues(a[sort.key], b[sort.key], sort.dir, compareText);
    });
  }, [members, filter, sort.key, sort.dir]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-[240px]" aria-label="Ausbildung filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-ink-faint">
          {filtered.length} von {members.length} Mitgliedern
        </span>
      </div>

      <MobileSortControl
        options={SORT_OPTIONS}
        sortKey={sort.key}
        dir={sort.dir}
        onKeyChange={sort.setKey}
        onToggleDir={sort.toggleDir}
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-muted">Kein Mitglied entspricht dem Filter.</p>
      ) : (
        <>
          <div className="flex flex-col divide-y divide-line border-t border-line sm:hidden">
            {filtered.map((member) => (
              <div key={member.id} className="flex flex-col gap-1.5 py-2.5">
                <span className="text-sm font-medium text-ink">
                  <MemberName member={member} canLinkToUser={canLinkToUser} />
                  <span className="ml-2 text-xs font-normal text-ink-faint">{member.feuerwehr}</span>
                </span>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {STUFEN.map((s) => (
                    <div key={s.key} className="flex justify-between gap-2">
                      <dt className="text-ink-faint">{s.label}</dt>
                      <dd className={member[s.key] ? 'font-mono text-ink' : 'text-ink-faint'}>
                        {member[s.key] ? formatDate(member[s.key]!) : '–'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                  <SortableHead label="Name" active={sort.key === 'name'} dir={sort.dir} onClick={() => sort.toggle('name')} />
                  <SortableHead
                    label="Feuerwehr"
                    active={sort.key === 'feuerwehr'}
                    dir={sort.dir}
                    onClick={() => sort.toggle('feuerwehr')}
                  />
                  {STUFEN.map((s) => (
                    <SortableHead
                      key={s.key}
                      label={s.label}
                      active={sort.key === s.key}
                      dir={sort.dir}
                      onClick={() => sort.toggle(s.key)}
                    />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((member) => (
                  <TableRow key={member.id} className="border-line">
                    <TableCell className="text-ink">
                      <MemberName member={member} canLinkToUser={canLinkToUser} />
                    </TableCell>
                    <TableCell className="text-ink-muted">{member.feuerwehr}</TableCell>
                    {STUFEN.map((s) => (
                      <TableCell key={s.key} className={member[s.key] ? 'font-mono text-ink' : 'text-ink-faint'}>
                        {member[s.key] ? formatDate(member[s.key]!) : '–'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
