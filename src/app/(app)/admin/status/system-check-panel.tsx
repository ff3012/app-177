'use client';

import { useState, useTransition } from 'react';
import { runSystemCheck, type SystemCheckResult } from './actions';

interface CheckRow {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('de-AT') : 'nie';
}

function buildRows(result: SystemCheckResult): CheckRow[] {
  return [
    { key: 'server', label: 'Server läuft', ok: result.server, detail: result.server ? 'OK' : 'Fehler' },
    { key: 'docker', label: 'Docker läuft', ok: result.docker, detail: result.docker ? 'OK' : 'Fehler' },
    { key: 'mailjet', label: 'Mailjet Integration', ok: result.mailjet, detail: result.mailjet ? 'OK' : 'Fehler' },
    {
      key: 'newsCron',
      label: 'Cron Job (News)',
      ok: result.newsCron.ok,
      detail: result.newsCron.lastRunAt ? `Zuletzt gelaufen: ${formatDate(result.newsCron.lastRunAt)}` : 'Noch nie gelaufen',
    },
    {
      key: 'ntpSync',
      label: 'NTP-Synchronisierung',
      ok: result.ntpSync.ok,
      detail:
        result.ntpSync.driftSeconds === null
          ? 'Konnte nicht geprüft werden'
          : `Abweichung: ${result.ntpSync.driftSeconds}s`,
    },
    {
      key: 'lastBackup',
      label: 'Letztes Backup',
      ok: result.lastBackup.ok,
      detail: result.lastBackup.lastBackupAt ? formatDate(result.lastBackup.lastBackupAt) : 'Noch kein Backup erfasst',
    },
  ];
}

export function SystemCheckPanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SystemCheckResult | null>(null);

  function runCheck() {
    startTransition(async () => {
      const outcome = await runSystemCheck();
      setResult(outcome);
    });
  }

  const rows = result ? buildRows(result) : [];

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={runCheck}
        disabled={pending}
        className="self-start rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Prüfe…' : 'System Check'}
      </button>

      {result && (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
              <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${row.ok ? 'bg-green-600' : 'bg-red-600'}`} />
              <span className="text-sm font-medium text-neutral-900">{row.label}</span>
              <span className={`ml-auto text-sm font-medium ${row.ok ? 'text-green-700' : 'text-red-700'}`}>
                {row.detail}
              </span>
            </div>
          ))}
          <p className="text-xs text-neutral-400">Zuletzt geprüft: {new Date(result.checkedAt).toLocaleString('de-AT')}</p>
        </div>
      )}
    </div>
  );
}
