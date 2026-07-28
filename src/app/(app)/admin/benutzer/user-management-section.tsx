'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  stbNr: string;
  phone: string;
  homeOrg: string;
  adminFor: string;
  droneLabel: string;
  statusLabel: string;
}

type SortKey = 'name' | 'email' | 'stbNr' | 'phone' | 'homeOrg' | 'adminFor' | 'droneLabel' | 'statusLabel';

const COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'name', label: 'Name', width: 'w-[14%]' },
  { key: 'email', label: 'E-Mail', width: 'w-[19%]' },
  { key: 'stbNr', label: 'StbNr', width: 'w-[8%]' },
  { key: 'phone', label: 'Telefonnummer', width: 'w-[12%]' },
  { key: 'homeOrg', label: 'Heimat-Feuerwehr', width: 'w-[12%]' },
  { key: 'adminFor', label: 'Admin für', width: 'w-[14%]' },
  { key: 'droneLabel', label: 'Drohnengruppe', width: 'w-[8%]' },
  { key: 'statusLabel', label: 'Status', width: 'w-[8%]' },
];

export function UserManagementSection({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.email, u.stbNr, u.phone, u.homeOrg, u.adminFor, u.droneLabel, u.statusLabel].some((field) =>
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
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/admin/benutzer/export"
            className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Excel Export
          </a>
          <Link
            href="/admin/benutzer/import"
            className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Excel Import
          </Link>
          <Link
            href="/admin/benutzer/neu"
            className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark"
          >
            Neuer Benutzer
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              {COLUMNS.map((column) => {
                const active = column.key === sortKey;
                return (
                  <th key={column.key} className={`${column.width} px-3 py-2 align-bottom`}>
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={`break-words text-left font-medium hover:text-neutral-900 ${active ? 'text-neutral-900' : ''}`}
                    >
                      {column.label}
                      {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                );
              })}
              <th className="w-[5%] px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id} className="border-b border-neutral-100">
                <td className="break-words px-3 py-2">{u.name}</td>
                <td className="break-words px-3 py-2">{u.email}</td>
                <td className="break-words px-3 py-2">{u.stbNr || '–'}</td>
                <td className="break-words px-3 py-2">{u.phone || '–'}</td>
                <td className="break-words px-3 py-2">{u.homeOrg}</td>
                <td className="break-words px-3 py-2">{u.adminFor}</td>
                <td className="break-words px-3 py-2">{u.droneLabel}</td>
                <td className="break-words px-3 py-2">{u.statusLabel}</td>
                <td className="break-words px-3 py-2 text-right">
                  <Link href={`/admin/benutzer/${u.id}`} className="text-brand hover:underline">
                    Bearbeiten
                  </Link>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">
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
