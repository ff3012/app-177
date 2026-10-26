'use client';

import { useState } from 'react';
import { TableHead } from '@/components/ui/table';

export type SortDir = 'asc' | 'desc';

export function useSort<K extends string>(initialKey: K, initialDir: SortDir = 'asc') {
  const [key, setKey] = useState<K>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  function toggle(next: K) {
    if (next === key) {
      setDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setKey(next);
      setDir('asc');
    }
  }

  return { key, dir, setKey, toggleDir: () => setDir((d) => (d === 'asc' ? 'desc' : 'asc')), toggle };
}

/** Vergleich mit fester Richtung; leere Werte (null) stehen in beiden Richtungen am Ende. */
export function compareValues<T>(a: T | null, b: T | null, dir: SortDir, compare: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const result = compare(a, b);
  return dir === 'asc' ? result : -result;
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base' });
}

export function SortableHead({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <TableHead
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted"
    >
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 uppercase hover:text-ink">
        {label}
        <span aria-hidden="true" className={active ? 'text-ink' : 'text-ink-faint'}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}

/** Sortierung für die Kartenansicht auf dem Handy, wo es keine Spaltenköpfe gibt. */
export function MobileSortControl<K extends string>({
  options,
  sortKey,
  dir,
  onKeyChange,
  onToggleDir,
}: {
  options: { key: K; label: string }[];
  sortKey: K;
  dir: SortDir;
  onKeyChange: (key: K) => void;
  onToggleDir: () => void;
}) {
  return (
    <div className="flex items-center gap-2 sm:hidden">
      <select
        value={sortKey}
        onChange={(e) => onKeyChange(e.target.value as K)}
        aria-label="Sortieren nach"
        className="h-9 flex-1 rounded-md border border-line bg-surface px-2 text-sm text-ink"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            Sortieren: {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onToggleDir}
        aria-label={dir === 'asc' ? 'Aufsteigend, zum Umkehren tippen' : 'Absteigend, zum Umkehren tippen'}
        className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink"
      >
        {dir === 'asc' ? '▲ Aufsteigend' : '▼ Absteigend'}
      </button>
    </div>
  );
}
