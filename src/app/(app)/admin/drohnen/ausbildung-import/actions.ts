'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canImportDroneAusbildung } from '@/lib/auth/permissions';
import { AUSBILDUNG_IMPORT_COLUMNS, type AusbildungImportRow } from '@/lib/drone/ausbildung-import-columns';
import {
  AUSBILDUNG_IMPORT_CHAIN,
  resolveAusbildungUpdates,
  type AusbildungStufe,
} from '@/lib/drone/ausbildung-import-helpers';

export interface ImportAusbildungState {
  error?: string;
  result?: {
    updatedFields: number;
    skippedAlreadySet: number;
    skippedMissingPrereq: string[];
    skippedNotMember: number;
    emailMismatches: string[];
    errors: string[];
  };
}

/** exceljs kann für Rich-Text/Formel/Hyperlink/Fehler-Zellen ein Objekt statt eines primitiven Werts
 * liefern - ein bloßes String(...) würde das dann als "[object Object]" schreiben/vergleichen. Löst die
 * gängigen Fälle gezielt auf, bevor auf String(...) als letzten Fallback zurückgefallen wird. Identisch
 * zu atemschutz-import/actions.ts's eigener Kopie - bewusst dupliziert, nicht extrahiert (siehe
 * CLAUDE.md-Konvention: Duplikation statt verfrühter Abstraktion für zwei Aufrufstellen). */
function cellText(value: unknown): string {
  if (value && typeof value === 'object') {
    if ('richText' in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((part: any) => part.text ?? '').join('');
    }
    if ('error' in value) return '';
    if ('result' in value) return String((value as any).result ?? '');
    if ('text' in value) return String((value as any).text ?? '');
  }
  return String(value ?? '');
}

/** Parst ein Datum aus einer Excel-Zelle - entweder ein von exceljs bereits als Date erkannter Zellwert
 * oder ein "dd.mm.yyyy"-Text. Liefert "YYYY-MM-DD" oder null. Identisch zu atemschutz-import/actions.ts's
 * eigener Kopie, siehe Kommentar dort. */
function parseExcelDateToIso(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = cellText(value).trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const STUFE_LABEL: Record<AusbildungStufe, string> = {
  a1a3LizenzAm: 'A1/A3',
  a2LizenzAm: 'A2',
  bos1AusbildungAm: 'BOS1',
  bos2AusbildungAm: 'BOS2',
};

const DATE_COLUMN_BY_STUFE: Record<AusbildungStufe, keyof AusbildungImportRow> = {
  a1a3LizenzAm: 'a1a3Datum',
  a2LizenzAm: 'a2Datum',
  bos1AusbildungAm: 'bos1Datum',
  bos2AusbildungAm: 'bos2Datum',
};

/**
 * Bezirksweit (nicht org-gebunden wie der Atemschutz-Import): FW-Nr löst die Feuerwehr auf, StbNr
 * matcht INNERHALB dieser Feuerwehr gegen User.stbNr (nicht global eindeutig) - mehrfach vorhandene
 * StbNr wird als nicht eindeutig zuordenbar abgelehnt statt eine willkürliche Zeile zu treffen. Nur
 * bereits bestehende DrohnengruppeMembership-Zeilen werden aktualisiert - der Import legt nie eine neue
 * an (siehe Design-Spec Abschnitt 2 Punkt 1). Pro der 4 Stufen wird nur ein aktuell leeres Feld befüllt,
 * nie ein bereits gesetztes überschrieben (resolveAusbildungUpdates, siehe Design-Spec Abschnitt 2 Punkt 2
 * und 3) - macht einen erneuten Import derselben Datei ungefährlich (0 Updates beim zweiten Lauf).
 */
export async function importAusbildung(
  _prevState: ImportAusbildungState,
  formData: FormData,
): Promise<ImportAusbildungState> {
  const user = await requireUser();
  assertPermission(canImportDroneAusbildung(user));

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Siehe atemschutz-import/actions.ts für die Begründung des any-Casts (exceljs bringt eine eigene,
    // alte @types/node-Kopie mit, strukturell inkompatibel mit unserer @types/node@22).
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    console.error('Ausbildungs-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  const columnIndexByKey = new Map<keyof AusbildungImportRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = AUSBILDUNG_IMPORT_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingColumns = AUSBILDUNG_IMPORT_COLUMNS.filter((column) => !columnIndexByKey.has(column.key));
  if (missingColumns.length > 0) {
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingColumns.map((c) => c.header).join(', ')}.` };
  }

  const organizations = await prisma.organization.findMany({ select: { id: true, nummer: true } });
  const organizationIdByNummer = new Map(organizations.map((org) => [org.nummer, org.id]));

  const members = await prisma.user.findMany({
    select: {
      id: true,
      stbNr: true,
      email: true,
      homeOrganizationId: true,
      droneMembership: {
        select: { a1a3LizenzAm: true, a2LizenzAm: true, bos1AusbildungAm: true, bos2AusbildungAm: true },
      },
    },
  });
  const membersByOrgAndStbNr = new Map<string, typeof members>();
  for (const member of members) {
    if (!member.stbNr) continue;
    const key = `${member.homeOrganizationId}|${member.stbNr}`;
    const existing = membersByOrgAndStbNr.get(key) ?? [];
    existing.push(member);
    membersByOrgAndStbNr.set(key, existing);
  }

  const errors: string[] = [];
  const emailMismatches: string[] = [];
  const skippedMissingPrereq: string[] = [];
  let updatedFields = 0;
  let skippedAlreadySet = 0;
  let skippedNotMember = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof AusbildungImportRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return cellText(row.getCell(colIndex).value).trim();
    };

    const fwNr = getValue('fwNr');
    const stbNr = getValue('stbNr');
    const email = getValue('email');

    if (!fwNr && !stbNr) continue; // leere Zeile überspringen

    const organizationId = organizationIdByNummer.get(fwNr);
    if (!organizationId) {
      errors.push(`Zeile ${rowNumber}: Feuerwehr mit FW-Nr "${fwNr}" wurde nicht gefunden.`);
      continue;
    }

    const matched = membersByOrgAndStbNr.get(`${organizationId}|${stbNr}`);
    if (!matched || matched.length === 0) {
      errors.push(`Zeile ${rowNumber}: Standesbuchnummer "${stbNr}" wurde in dieser Feuerwehr nicht gefunden.`);
      continue;
    }
    if (matched.length > 1) {
      errors.push(`Zeile ${rowNumber}: Standesbuchnummer "${stbNr}" mehrfach vorhanden, Zeile übersprungen.`);
      continue;
    }
    const member = matched[0];

    if (email && member.email && email.toLowerCase() !== member.email.toLowerCase()) {
      emailMismatches.push(
        `Zeile ${rowNumber}: E-Mail in Datei ("${email}") weicht von gespeicherter Adresse ("${member.email}") ab.`,
      );
    }

    if (!member.droneMembership) {
      skippedNotMember++;
      continue;
    }

    const fileValues: Record<AusbildungStufe, Date | null> = {
      a1a3LizenzAm: null,
      a2LizenzAm: null,
      bos1AusbildungAm: null,
      bos2AusbildungAm: null,
    };
    let hasDateError = false;
    for (const stufe of AUSBILDUNG_IMPORT_CHAIN) {
      const colIndex = columnIndexByKey.get(DATE_COLUMN_BY_STUFE[stufe])!;
      const rawValue = row.getCell(colIndex).value;
      const text = cellText(rawValue).trim();
      if (!text) continue;
      const iso = parseExcelDateToIso(rawValue);
      if (!iso) {
        errors.push(`Zeile ${rowNumber}: Ungültiges Datum in ${STUFE_LABEL[stufe]} Datum.`);
        hasDateError = true;
        break;
      }
      fileValues[stufe] = new Date(iso);
    }
    if (hasDateError) continue;

    const current: Record<AusbildungStufe, Date | null> = {
      a1a3LizenzAm: member.droneMembership.a1a3LizenzAm,
      a2LizenzAm: member.droneMembership.a2LizenzAm,
      bos1AusbildungAm: member.droneMembership.bos1AusbildungAm,
      bos2AusbildungAm: member.droneMembership.bos2AusbildungAm,
    };

    const resolution = resolveAusbildungUpdates(current, fileValues);
    skippedAlreadySet += resolution.skippedAlreadySet.length;
    for (const { stufe, fehlendeVorstufe } of resolution.skippedMissingPrereq) {
      skippedMissingPrereq.push(
        `Zeile ${rowNumber}: ${STUFE_LABEL[stufe]} übersprungen, da ${STUFE_LABEL[fehlendeVorstufe]} fehlt.`,
      );
    }

    const updateKeys = Object.keys(resolution.updates) as AusbildungStufe[];
    if (updateKeys.length === 0) continue;

    try {
      await prisma.drohnengruppeMembership.update({
        where: { userId: member.id },
        data: resolution.updates,
      });
      updatedFields += updateKeys.length;
    } catch (error) {
      console.error(`Ausbildungs-Import Zeile ${rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${rowNumber}: Unerwarteter Fehler beim Speichern.`);
    }
  }

  revalidatePath('/admin/drohnen');
  return {
    result: { updatedFields, skippedAlreadySet, skippedMissingPrereq, skippedNotMember, emailMismatches, errors },
  };
}
