'use client';

import { useState, useTransition } from 'react';
import { runSystemCheck, type SystemCheckResult } from './actions';

const CHECKS: { key: 'server' | 'docker' | 'mailjet'; label: string }[] = [
  { key: 'server', label: 'Server läuft' },
  { key: 'docker', label: 'Docker läuft' },
  { key: 'mailjet', label: 'Mailjet Integration' },
];

export function SystemCheckPanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SystemCheckResult | null>(null);

  function runCheck() {
    startTransition(async () => {
      const outcome = await runSystemCheck();
      setResult(outcome);
    });
  }

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
          {CHECKS.map(({ key, label }) => {
            const ok = result[key];
            return (
              <div key={key} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
                <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${ok ? 'bg-green-600' : 'bg-red-600'}`} />
                <span className="text-sm font-medium text-neutral-900">{label}</span>
                <span className={`ml-auto text-sm font-medium ${ok ? 'text-green-700' : 'text-red-700'}`}>
                  {ok ? 'OK' : 'Fehler'}
                </span>
              </div>
            );
          })}
          <p className="text-xs text-neutral-400">Zuletzt geprüft: {new Date(result.checkedAt).toLocaleString('de-AT')}</p>
        </div>
      )}
    </div>
  );
}
