import { prisma } from '@/lib/db/prisma';
import { checkMailjetConnection } from '@/lib/email/mailjet';
import { checkNtpDrift } from '@/lib/system/ntp-check';
import { checkS3Connection } from '@/lib/system/s3-check';
import { getLastNewsCronRunAt, getLastBackupAt, getLastS3BackupAt } from '@/lib/settings';

const NEWS_CRON_STALE_AFTER_MS = 15 * 60 * 1000; // Cron läuft alle 5 Minuten - 15 Min. Toleranz
const BACKUP_STALE_AFTER_MS = 26 * 60 * 60 * 1000; // nächtliches Backup - 26h Toleranz

export interface SystemCheckResult {
  server: boolean;
  docker: boolean;
  mailjet: boolean;
  newsCron: { ok: boolean; lastRunAt: string | null };
  ntpSync: { ok: boolean; driftSeconds: number | null };
  lastBackup: { ok: boolean; lastBackupAt: string | null };
  s3Connection: boolean;
  s3Backup: { ok: boolean; lastBackupAt: string | null };
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
 *
 * "S3 Exoscale Verbindung" prüft live per HeadBucket (lib/system/s3-check.ts), ob der Bucket mit den
 * konfigurierten Zugangsdaten erreichbar ist - unabhängig davon, ob je ein Backup hochgeladen wurde.
 * "Letztes S3-Backup" ist wieder eine AppSettings-Staleness-Prüfung wie "Letztes Backup", nur dass
 * backup.sh den Zeitstempel erst NACH einem erfolgreichen `aws s3 cp` des Dumps schreibt - schlägt der
 * Upload fehl, bricht das Skript per `set -e` vorher ab und lastS3BackupAt bleibt veraltet, ganz ohne
 * eigene Fehlerbehandlung im Skript.
 */
export async function getSystemCheckResult(): Promise<SystemCheckResult> {
  const [docker, mailjet, ntp, s3Connection, lastNewsCronRunAt, lastBackupAt, lastS3BackupAt] = await Promise.all([
    checkDatabaseConnection(),
    checkMailjetConnection(),
    checkNtpDrift(),
    checkS3Connection(),
    getLastNewsCronRunAt(),
    getLastBackupAt(),
    getLastS3BackupAt(),
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
    s3Connection,
    s3Backup: {
      ok: Boolean(lastS3BackupAt) && now - lastS3BackupAt!.getTime() <= BACKUP_STALE_AFTER_MS,
      lastBackupAt: lastS3BackupAt ? lastS3BackupAt.toISOString() : null,
    },
    checkedAt: new Date().toISOString(),
  };
}
