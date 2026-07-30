import type { SystemCheckResult } from './system-check';

export interface SystemCheckRow {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('de-AT') : 'nie';
}

/**
 * Baut die Anzeige-Zeilen (Label/OK/Detail) aus einem SystemCheckResult - eine gemeinsame Stelle
 * für die Status-Seite (system-check-panel.tsx, 'use client') UND die tägliche Systemcheck-E-Mail
 * (lib/email/templates.ts, server-only), damit Labels/Detail-Texte zwischen UI und E-Mail nicht
 * auseinanderlaufen. Bewusst in einer eigenen, abhängigkeitsfreien Datei getrennt von
 * system-check.ts (das Prisma/Mailjet/NTP-Checks importiert) - sonst würde der Client-Bundle des
 * Panels versuchen, Prisma mitzubündeln, nur um diese reine Formatierungsfunktion zu nutzen.
 */
export function buildSystemCheckRows(result: SystemCheckResult): SystemCheckRow[] {
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
