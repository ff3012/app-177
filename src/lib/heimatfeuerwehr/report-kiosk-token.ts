import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** 24 Zufallsbytes = 192 Bit, als 32 URL-sichere Zeichen. */
export function generateReportKioskToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Formprüfung vor jeder Datenbankabfrage: ein offensichtlich falscher Wert erreicht die DB nie. */
export function isPlausibleReportKioskToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Erzeugt den Link der Schnellerfassung oder dreht ihn neu (der alte Wert ist sofort ungültig).
 * Nur aktive Feuerwehren (nicht Abschnittskommandos): Berichte gehören immer einer Feuerwehr.
 */
export async function setReportKioskToken(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR', isActive: true },
    select: { id: true },
  });
  if (!organization) throw new Error('Die Schnellerfassung gibt es nur für aktive Feuerwehren.');

  const token = generateReportKioskToken();
  await prisma.organization.update({ where: { id: organization.id }, data: { reportKioskToken: token } });
  return token;
}

/** Schaltet die Schnellerfassung ab: der bisherige Link antwortet danach 404. */
export async function clearReportKioskToken(organizationId: string): Promise<void> {
  await prisma.organization.update({ where: { id: organizationId }, data: { reportKioskToken: null } });
}

/** Löst einen Link auf. Unbekannt, abgeschaltet, neu erzeugt oder Organisation deaktiviert: null. */
export async function findOrganizationByKioskToken(token: string): Promise<{ id: string; name: string } | null> {
  if (!isPlausibleReportKioskToken(token)) return null;
  return prisma.organization.findUnique({
    where: { reportKioskToken: token, isActive: true },
    select: { id: true, name: true },
  });
}
