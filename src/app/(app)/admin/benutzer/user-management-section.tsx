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
  pushLabel: string;
  statusLabel: string;
}

type SortKey =
  | 'name'
  | 'email'
  | 'stbNr'
  | 'phone'
  | 'homeOrg'
  | 'adminFor'
  | 'droneLabel'
  | 'pushLabel'
  | 'statusLabel';

const COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'name', label: 'Name', width: 'w-[13%]' },
  { key: 'email', label: 'E-Mail', width: 'w-[17%]' },
  { key: 'stbNr', label: 'StbNr', width: 'w-[7%]' },
  { key: 'phone', label: 'Telefonnummer', width: 'w-[11%]' },
  { key: 'homeOrg', label: 'Heimat-Feuerwehr', width: 'w-[11%]' },
  { key: 'adminFor', label: 'Admin für', width: 'w-[13%]' },
  { key: 'droneLabel', label: 'Drohnengruppe', width: 'w-[7%]' },
  { key: 'pushLabel', label: 'Push', width: 'w-[9%]' },
  { key: 'statusLabel', label: 'Status', width: 'w-[7%]' },
];

const EMPTY_MESSAGE = 'Keine Benutzer gefunden.';

/** Kartenansicht für schmale Bildschirme - die restlichen 6 Felder (neben Name/E-Mail/Status) als
 * Label/Wert-Grid, analog zu EventCard in components/calendar/event-list-view.tsx. Die ganze
 * Karte ist der Bearbeiten-Link (statt des kleinen Stift-Icons in der Tabelle). */
function UserCard({ user }: { user: UserRow }) {
  return (
    <Link href={`/admin/benutzer/${user.id}`} className="block border-b border-neutral-100 px-4 py-3 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-neutral-900">{user.name}</span>
        <span className={`text-sm font-medium ${user.statusLabel === 'Aktiv' ? 'text-green-700' : 'text-neutral-500'}`}>
          {user.statusLabel}
        </span>
      </div>
      <div className="break-words text-sm text-neutral-500">{user.email}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <div>
          <div className="text-xs text-neutral-400">StbNr</div>
          <div className="break-words text-neutral-700">{user.stbNr || '–'}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Telefonnummer</div>
          <div className="break-words text-neutral-700">{user.phone || '–'}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Heimat-Feuerwehr</div>
          <div className="break-words text-neutral-700">{user.homeOrg}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Admin für</div>
          <div className="break-words text-neutral-700">{user.adminFor}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Drohnengruppe</div>
          <div className="break-words text-neutral-700">{user.droneLabel}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Push</div>
          <div className="break-words text-neutral-700">{user.pushLabel}</div>
        </div>
      </div>
    </Link>
  );
}

export function UserManagementSection({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.email, u.stbNr, u.phone, u.homeOrg, u.adminFor, u.droneLabel, u.pushLabel, u.statusLabel].some(
        (field) => field.toLowerCase().includes(q),
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

      {/* Sortier-Steuerung nur für die Kartenansicht - die Tabelle hat klickbare Spaltenköpfe,
          die auf einer Karte keine Entsprechung haben. Nutzt dieselben sortKey/sortDir/toggleSort
          wie die Tabelle, damit beide Ansichten nie auseinanderlaufen. */}
      <div className="flex gap-2 sm:hidden">
        <select
          value={sortKey}
          onChange={(event) => toggleSort(event.target.value as SortKey)}
          aria-label="Sortieren nach"
          className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-sm"
        >
          {COLUMNS.map((column) => (
            <option key={column.key} value={column.key}>
              Sortieren: {column.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
          aria-label="Sortierrichtung umkehren"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700"
        >
          {sortDir === 'asc' ? '▲ A–Z' : '▼ Z–A'}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">{EMPTY_MESSAGE}</div>
      ) : (
        <>
          <div className="flex flex-col rounded-lg bg-white shadow-sm sm:hidden">
            {sorted.map((u) => (
              <UserCard key={u.id} user={u} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm sm:block">
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
                          className={`block w-full break-words text-left font-medium hover:text-neutral-900 ${active ? 'text-neutral-900' : ''}`}
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
                    <td className="break-words px-3 py-2">{u.pushLabel}</td>
                    <td className="break-words px-3 py-2">{u.statusLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link
                        href={`/admin/benutzer/${u.id}`}
                        aria-label="Bearbeiten"
                        title="Bearbeiten"
                        className="inline-flex rounded border border-neutral-300 bg-white p-1.5 text-neutral-600 hover:bg-neutral-100"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <path
                            d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
