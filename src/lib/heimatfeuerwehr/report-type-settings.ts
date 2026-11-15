import type { ReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ACTIVE_REPORT_TYPES } from './report-constants';

export interface ReportTypeSettingValue {
  enabled: boolean;
  recipients: string[];
}

/** Nur die in der App freigeschalteten Berichtsarten (heute Tätigkeits- und Übungsbericht) sind einstellbar. */
export function isActiveReportType(type: string): type is ReportType {
  return ACTIVE_REPORT_TYPES.includes(type);
}

/** Reine Logik: Einstellung je freigeschalteter Art; fehlende Zeile = eingeschaltet, keine Empfänger. */
export function resolveReportTypeSettings(
  rows: { type: string; enabled: boolean; recipients: string[] }[],
): Record<string, ReportTypeSettingValue> {
  return Object.fromEntries(
    ACTIVE_REPORT_TYPES.map((type) => {
      const row = rows.find((candidate) => candidate.type === type);
      return [type, row ? { enabled: row.enabled, recipients: [...row.recipients] } : { enabled: true, recipients: [] }];
    }),
  );
}

/** Reine Logik: gewünschte Art, wenn eingeschaltet, sonst die erste eingeschaltete, sonst null. */
export function pickReportType(
  typeParam: string | undefined | null,
  enabledTypes: readonly string[],
): ReportType | null {
  if (typeParam && enabledTypes.includes(typeParam)) return typeParam as ReportType;
  return (enabledTypes[0] as ReportType | undefined) ?? null;
}

export async function getReportTypeSettings(organizationId: string): Promise<Record<string, ReportTypeSettingValue>> {
  const rows = await prisma.reportTypeSetting.findMany({
    where: { organizationId },
    select: { type: true, enabled: true, recipients: true },
  });
  return resolveReportTypeSettings(rows);
}

/** Eingeschaltete Arten in der Reihenfolge von `ACTIVE_REPORT_TYPES`. */
export async function getEnabledReportTypes(organizationId: string): Promise<ReportType[]> {
  const settings = await getReportTypeSettings(organizationId);
  return ACTIVE_REPORT_TYPES.filter((type) => settings[type]?.enabled) as ReportType[];
}

/** Nicht freigeschaltete Art: false. Ohne Zeile: true (Voreinstellung). */
export async function isReportTypeEnabled(organizationId: string, type: string): Promise<boolean> {
  if (!isActiveReportType(type)) return false;
  const row = await prisma.reportTypeSetting.findUnique({
    where: { organizationId_type: { organizationId, type } },
    select: { enabled: true },
  });
  return row ? row.enabled : true;
}

/** E-Mail-Empfänger des Berichts dieser Art; ohne Zeile keine. */
export async function getReportRecipients(organizationId: string, type: string): Promise<string[]> {
  if (!isActiveReportType(type)) return [];
  const row = await prisma.reportTypeSetting.findUnique({
    where: { organizationId_type: { organizationId, type } },
    select: { recipients: true },
  });
  return row?.recipients ?? [];
}

async function assertConfigurable(organizationId: string, type: string): Promise<ReportType> {
  if (!isActiveReportType(type)) throw new Error('Diese Berichtsart ist nicht verfügbar.');
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR' },
    select: { id: true },
  });
  if (!organization) throw new Error('Berichtsarten gibt es nur für Feuerwehren.');
  return type;
}

export async function saveReportTypeEnabled(organizationId: string, type: string, enabled: boolean): Promise<void> {
  const validType = await assertConfigurable(organizationId, type);
  await prisma.reportTypeSetting.upsert({
    where: { organizationId_type: { organizationId, type: validType } },
    create: { organizationId, type: validType, enabled },
    update: { enabled },
  });
}

export async function saveReportTypeRecipients(organizationId: string, type: string, recipients: string[]): Promise<void> {
  const validType = await assertConfigurable(organizationId, type);
  const unique = [...new Set(recipients)];
  await prisma.reportTypeSetting.upsert({
    where: { organizationId_type: { organizationId, type: validType } },
    create: { organizationId, type: validType, recipients: unique },
    update: { recipients: unique },
  });
}
