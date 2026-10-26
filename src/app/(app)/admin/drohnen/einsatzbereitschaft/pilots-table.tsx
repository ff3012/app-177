'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import type { EinsatzbereitschaftStatus, PilotEinsatzbereitschaft } from '@/lib/drone/einsatzbereitschaft';
import { MobileSortControl, SortableHead, compareText, compareValues, useSort } from './sortable';

type PilotSortKey = 'name' | 'feuerwehr' | 'flights' | 'status';

const SORT_OPTIONS: { key: PilotSortKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'name', label: 'Name' },
  { key: 'feuerwehr', label: 'Feuerwehr' },
  { key: 'flights', label: 'Flüge (90 Tage)' },
];

const STATUS_LABEL: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'Einsatzbereit',
  GELB: 'Bald fällig',
  ROT: 'Nicht einsatzbereit',
};

const STATUS_CLASS: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'border-transparent bg-success-subtle text-success-text',
  GELB: 'border-transparent bg-warning-subtle text-warning-text',
  ROT: 'border-transparent bg-danger-subtle text-danger',
};

/** Aufsteigend = dringendste zuerst (Nicht einsatzbereit, Bald fällig, Einsatzbereit). */
const STATUS_RANK: Record<EinsatzbereitschaftStatus, number> = { ROT: 0, GELB: 1, GRUEN: 2 };

function PilotName({ pilot, canLinkToUser }: { pilot: PilotEinsatzbereitschaft; canLinkToUser: boolean }) {
  if (!canLinkToUser) return <>{pilot.name}</>;
  return (
    <Link href={`/admin/benutzer?edit=${pilot.id}`} className="hover:underline">
      {pilot.name}
    </Link>
  );
}

export function PilotsTable({ pilots, canLinkToUser }: { pilots: PilotEinsatzbereitschaft[]; canLinkToUser: boolean }) {
  const sort = useSort<PilotSortKey>('status');

  const sorted = useMemo(() => {
    return [...pilots].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return compareValues(a.name, b.name, sort.dir, compareText);
        case 'feuerwehr':
          return compareValues(a.feuerwehr, b.feuerwehr, sort.dir, compareText);
        case 'flights':
          return compareValues(a.flightCount, b.flightCount, sort.dir, (x, y) => x - y);
        case 'status':
          return compareValues(STATUS_RANK[a.status], STATUS_RANK[b.status], sort.dir, (x, y) => x - y);
      }
    });
  }, [pilots, sort.key, sort.dir]);

  return (
    <div className="flex flex-col gap-3">
      <MobileSortControl
        options={SORT_OPTIONS}
        sortKey={sort.key}
        dir={sort.dir}
        onKeyChange={sort.setKey}
        onToggleDir={sort.toggleDir}
      />

      <div className="flex flex-col divide-y divide-line border-t border-line sm:hidden">
        {sorted.map((pilot) => (
          <div key={pilot.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-sm text-ink">
                <PilotName pilot={pilot} canLinkToUser={canLinkToUser} />
              </span>
              <span className="text-xs text-ink-faint">
                {pilot.feuerwehr} · {pilot.flightCount} Flüge (90 Tage)
              </span>
            </div>
            <Badge variant="outline" className={STATUS_CLASS[pilot.status]}>
              {STATUS_LABEL[pilot.status]}
            </Badge>
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
              <SortableHead
                label="Flüge (90 Tage)"
                active={sort.key === 'flights'}
                dir={sort.dir}
                onClick={() => sort.toggle('flights')}
              />
              <SortableHead
                label="Status"
                active={sort.key === 'status'}
                dir={sort.dir}
                onClick={() => sort.toggle('status')}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((pilot) => (
              <TableRow key={pilot.id} className="border-line">
                <TableCell className="text-ink">
                  <PilotName pilot={pilot} canLinkToUser={canLinkToUser} />
                </TableCell>
                <TableCell className="text-ink-muted">{pilot.feuerwehr}</TableCell>
                <TableCell className="font-mono text-ink-muted">{pilot.flightCount}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_CLASS[pilot.status]}>
                    {STATUS_LABEL[pilot.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
