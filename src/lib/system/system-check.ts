import { prisma } from '@/lib/db/prisma';
import { checkMailjetConnection } from '@/lib/email/mailjet';
import { checkNtpDrift } from '@/lib/system/ntp-check';
import { getLastNewsCronRunAt, getLastBackupAt } from '@/lib/settings';

const NEWS_CRON_STALE_AFTER_MS = 15 * 60 * 1000; // Cron läuft alle 5 Minuten - 15 Min. Toleranz
const BACKUP_STALE_AFTER_MS = 26 * 60 * 60 * 1000; // nächtliches Backup - 26h Toleranz

export interface SystemCheckResult {
  server: boolean;
  docker: boolean;
  mailjet: boolean;
  newsCron: { ok: boolean; lastRunAt: string | null };
  ntpSync: { ok: boolean; driftSeconds: number | null };
  lastBackup: { ok: boolean; lastBackupAt: string | null };
  checkedAt: string;
}

async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Session-freier Kern des System Checks, ausgelagert aus admin/status/actions.ts, damit sowohl der
 * Admin-Server-Action (mit requireUser()/isSiteAdmin-Guard) als auch der tägliche Cron-E-Mail-Route
 * (kein Login möglich, siehe /api/cron/system-check) dieselbe Prüfung aufrufen können, ohne die
 * Guard-Logik zu duplizieren oder zu umgehen.
 *
 * "Docker läuft" wird indirekt über die Datenbankverbindung geprüft: App und Postgres laufen
 * als getrennte Docker-Compose-Container, verbunden über den Servicenamen "postgres" in
 * DATABASE_URL – eine erfolgreiche Query beweist, dass dieser Container erreichbar ist.
 *
 * "Cron Job" und "Letztes Backup" prüfen nicht den Host direkt (der App-Container hat weder
 * Zugriff auf die Host-Crontab noch auf docker/backups/) - stattdessen tragen der Cron-Endpunkt
 * und backup.sh selbst einen Zeitstempel in AppSettings ein, den diese Seite nur ausliest.
 * "NTP-Synchronisierung" vergleicht die eigene (mit dem Host geteilte) Systemzeit gegen einen
 * externen HTTP-Zeitstempel, siehe lib/system/ntp-check.ts.
 */
export async function getSystemCheckResult(): Promise<SystemCheckResult> {
  const [docker, mailjet, ntp, lastNewsCronRunAt, lastBackupAt] = await Promise.all([
    checkDatabaseConnection(),
    checkMailjetConnection(),
    checkNtpDrift(),
    getLastNewsCronRunAt(),
    getLastBackupAt(),
  ]);

  const now = Date.now();

  return {
    server: true,
    docker,
    mailjet,
    newsCron: {
      ok: Boolean(lastNewsCronRunAt) && now - lastNewsCronRunAt!.getTime() <= NEWS_CRON_STALE_AFTER_MS,
      lastRunAt: lastNewsCronRunAt ? lastNewsCronRunAt.toISOString() : null,
    },
    ntpSync: ntp,
    lastBackup: {
      ok: Boolean(lastBackupAt) && now - lastBackupAt!.getTime() <= BACKUP_STALE_AFTER_MS,
      lastBackupAt: lastBackupAt ? lastBackupAt.toISOString() : null,
    },
    checkedAt: new Date().toISOString(),
  };
}
