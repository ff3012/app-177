'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  homeOrg: string;
  adminFor: string;
  droneLabel: string;
  statusLabel: string;
}

type SortKey = 'name' | 'email' | 'homeOrg' | 'adminFor' | 'droneLabel' | 'statusLabel';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'E-Mail' },
  { key: 'homeOrg', label: 'Heimat-Feuerwehr' },
  { key: 'adminFor', label: 'Admin für' },
  { key: 'droneLabel', label: 'Drohnengruppe' },
  { key: 'statusLabel', label: 'Status' },
];

export function UserManagementSection({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.email, u.homeOrg, u.adminFor, u.droneLabel, u.statusLabel].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [users, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = a[sortKey].localeCompare(b[sortKey], 'de');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Benutzer suchen…"
          className="w-full rounded border border-neutral-300 px-3 py-1.5 text-sm sm:max-w-xs"
        />
        <Link
          href="/admin/benutzer/neu"
          className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark sm:self-auto"
        >
          Neuer Benutzer
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              {COLUMNS.map((column) => {
                const active = column.key === sortKey;
                return (
                  <th key={column.key} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={`font-medium hover:text-neutral-900 ${active ? 'text-neutral-900' : ''}`}
                    >
                      {column.label}
                      {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                );
              })}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id} className="border-b border-neutral-100">
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.homeOrg}</td>
                <td className="px-4 py-2">{u.adminFor}</td>
                <td className="px-4 py-2">{u.droneLabel}</td>
                <td className="px-4 py-2">{u.statusLabel}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/benutzer/${u.id}`} className="text-brand hover:underline">
                    Bearbeiten
                  </Link>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                  Keine Benutzer gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
