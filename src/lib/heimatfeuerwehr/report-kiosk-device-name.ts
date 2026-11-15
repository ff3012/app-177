import { prisma } from '@/lib/db/prisma';

export const DEVICE_NAME_MAX = 60;

export type ParsedDeviceName = { ok: true; value: string | null } | { ok: false; error: string };

/** Reine Logik: Gerätename aus dem Formularwert. Leer = Name entfernen (null), höchstens 60 Zeichen. */
export function parseDeviceName(raw: unknown): ParsedDeviceName {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Ungültige Eingabe.' };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > DEVICE_NAME_MAX) return { ok: false, error: `Höchstens ${DEVICE_NAME_MAX} Zeichen.` };
  return { ok: true, value };
}

/** Speichert den Gerätenamen; nur für aktive Feuerwehren (wie der Link selbst). */
export async function saveReportKioskDeviceName(organizationId: string, name: string | null): Promise<void> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR', isActive: true },
    select: { id: true },
  });
  if (!organization) throw new Error('Die Schnellerfassung gibt es nur für aktive Feuerwehren.');
  await prisma.organization.update({ where: { id: organization.id }, data: { reportKioskDeviceName: name } });
}
