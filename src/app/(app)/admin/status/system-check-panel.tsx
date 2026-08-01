'use client';

import { useState, useTransition } from 'react';
import { runSystemCheck, type SystemCheckResult } from './actions';
import { buildSystemCheckRows } from '@/lib/system/system-check-rows';

export function SystemCheckPanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SystemCheckResult | null>(null);

  function runCheck() {
    startTransition(async () => {
      const outcome = await runSystemCheck();
      setResult(outcome);
    });
  }

  // Fehlerhafte Zeilen zuerst (Verwaltung-Brief.md) - stabile Sortierung, da Array.prototype.sort
  // in Node/V8 garantiert stabil ist, die Zeilenreihenfolge innerhalb "ok"/"nicht ok" bleibt also
  // wie in buildSystemCheckRows definiert.
  const rows = result ? [...buildSystemCheckRows(result)].sort((a, b) => Number(a.ok) - Number(b.ok)) : [];

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={runCheck}
        disabled={pending}
        className="self-start rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? 'Prüfe…' : 'Jetzt prüfen'}
      </button>

      {result && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface shadow-card">
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-medium text-ink">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`h-2 w-2 shrink-0 rounded-full ${row.ok ? 'bg-success' : 'bg-danger'}`}
                    />
                    <span
                      className={`font-mono text-xs ${row.ok ? 'text-success-text' : 'text-danger'}`}
                    >
                      {row.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="font-mono text-xs text-ink-faint">
            Zuletzt geprüft: {new Date(result.checkedAt).toLocaleString('de-AT')}
          </p>
        </div>
      )}
    </div>
  );
}
