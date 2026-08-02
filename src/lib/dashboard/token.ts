import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';

export interface DashboardTokenRow {
  id: string;
  token: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Erzeugt einen neuen Kiosk-Dashboard-Token für eine Feuerwehr - randomBytes(24).toString('hex'),
 * exakt wie generateDroneQuickRegisterToken() in lib/settings.ts. Anders als dort gibt es hier
 * mehrere Tokens pro Organisation (jeder mit eigenem Ablauf/Widerruf), daher eine eigene Zeile statt
 * eines Singleton-Felds. */
export async function generateDashboardToken(
  organizationId: string,
  createdById: string,
): Promise<{ id: string; token: string }> {
  const token = randomBytes(24).toString('hex');
  const created = await prisma.dashboardToken.create({
    data: { token, organizationId, createdById },
    select: { id: true, token: true },
  });
  return created;
}

/** Prüft einen Token gegen die Datenbank - ungültig, widerrufen oder abgelaufen liefern alle null
 * zurück (die aufrufende Seite unterscheidet nicht zwischen den drei Fällen, siehe Design-Spec §1:
 * "kein Hinweis auf die Existenz der Seite"). Aktualisiert lastUsedAt NICHT selbst - siehe
 * touchDashboardTokenUsage, getrennt, damit ein reiner Lesevorgang (z. B. aus der Verwaltung) den
 * "zuletzt verwendet"-Zeitstempel nicht verfälscht. */
export async function getValidDashboardToken(
  token: string,
): Promise<{ id: string; organizationId: string } | null> {
  const row = await prisma.dashboardToken.findUnique({
    where: { token },
    select: { id: true, organizationId: true, expiresAt: true, revokedAt: true },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return { id: row.id, organizationId: row.organizationId };
}

export async function touchDashboardTokenUsage(tokenId: string): Promise<void> {
  await prisma.dashboardToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } });
}

export async function setDashboardTokenExpiry(tokenId: string, expiresAt: Date | null): Promise<void> {
  await prisma.dashboardToken.update({ where: { id: tokenId }, data: { expiresAt } });
}

export async function revokeDashboardToken(tokenId: string): Promise<void> {
  await prisma.dashboardToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
}

/** Alle Tokens einer Organisation, neueste zuerst - inklusive bereits widerrufener (die Verwaltungsseite
 * zeigt den Status als Badge, analog zum Kommend/Vergangen-Muster der Fahrzeug-Buchungen-Tabelle auf
 * derselben Seite), damit ein Admin nachvollziehen kann, was schon einmal ausgegeben wurde. */
export async function listDashboardTokens(organizationId: string): Promise<DashboardTokenRow[]> {
  return prisma.dashboardToken.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
  });
}
