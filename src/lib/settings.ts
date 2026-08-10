import { prisma } from '@/lib/db/prisma';

const SETTINGS_ID = 'singleton';

// getDroneFlightNotificationEmail/setDroneFlightNotificationEmail/getDroneQuickRegisterToken/
// generateDroneQuickRegisterToken wurden entfernt (Task 9, Bezirk/Abschnitt/Drohnengruppen-Plan) -
// beide Werte sind jetzt pro DroneGroup gespeichert (DroneGroup.flightNotificationEmail/qrToken)
// statt als AppSettings-Singleton-Felder app-weit. Ersetzt durch direkte Prisma-Lese-/Schreibzugriffe
// an den jeweiligen Aufrufstellen (admin/drohnen/actions.ts, drohnen-schnell/[token]/*), die die
// DroneGroup-Zeile ohnehin schon für andere Zwecke laden - siehe CLAUDE.md.

export async function getLastNewsCronRunAt(): Promise<Date | null> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.lastNewsCronRunAt ?? null;
}

/** Vom Cronjob-Endpunkt bei jedem Lauf aufgerufen (auch wenn nichts zu versenden war) — Status-Seite zeigt daran, ob der Cronjob überhaupt noch läuft. */
export async function recordNewsCronRun(): Promise<void> {
  const now = new Date();
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, lastNewsCronRunAt: now },
    update: { lastNewsCronRunAt: now },
  });
}

export async function getLastBackupAt(): Promise<Date | null> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.lastBackupAt ?? null;
}

/** Wird nur von docker/backup.sh per rohem psql-UPSERT geschrieben (kein Setter hier nötig, analog
 * zu lastBackupAt) - der App-Container hat keinen Zugriff auf den Host-Cronjob-Prozess selbst. */
export async function getLastS3BackupAt(): Promise<Date | null> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.lastS3BackupAt ?? null;
}

export async function getSystemCheckNotificationEmail(): Promise<string | null> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.systemCheckNotificationEmail ?? null;
}

export async function setSystemCheckNotificationEmail(email: string): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, systemCheckNotificationEmail: email },
    update: { systemCheckNotificationEmail: email },
  });
}
