'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MemberAusbildung } from '@/lib/drone/einsatzbereitschaft';

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

export function AusbildungTable({ members, canLinkToUser }: { members: MemberAusbildung[]; canLinkToUser: boolean }) {
  const [filter, setFilter] = useState('ALLE');
  const filtered = useMemo(() => members.filter((m) => matchesFilter(m, filter)), [members, filter]);

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

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-muted">Kein Mitglied entspricht dem Filter.</p>
      ) : (
        <>
          <div className="flex flex-col divide-y divide-line border-t border-line sm:hidden">
            {filtered.map((member) => (
              <div key={member.id} className="flex flex-col gap-1.5 py-2.5">
                <span className="text-sm font-medium text-ink">
                  <MemberName member={member} canLinkToUser={canLinkToUser} />
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
                  <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                  {STUFEN.map((s) => (
                    <TableHead
                      key={s.key}
                      className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted"
                    >
                      {s.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((member) => (
                  <TableRow key={member.id} className="border-line">
                    <TableCell className="text-ink">
                      <MemberName member={member} canLinkToUser={canLinkToUser} />
                    </TableCell>
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
