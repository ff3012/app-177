'use server';

import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isSiteAdmin } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/password';
import { createToken } from '@/lib/auth/tokens';
import { sendActivationEmail } from '@/lib/email/templates';
import { E164_PHONE_REGEX } from '@/lib/validation/user.schema';
import { USER_EXCEL_COLUMNS, USER_IMPORT_COLUMN_KEYS, type UserExcelRow } from '@/lib/admin/user-excel-columns';

export interface ImportUsersState {
  error?: string;
  result?: {
    created: number;
    skipped: number;
    errors: string[];
  };
}

export async function importUsers(_prevState: ImportUsersState, formData: FormData): Promise<ImportUsersState> {
  const currentUser = await requireUser();
  assertPermission(isSiteAdmin(currentUser));

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(new Uint8Array(await file.arrayBuffer()));
    await workbook.xlsx.load(buffer);
  } catch (error) {
    console.error('Excel-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  // Kopfzeile nach Spaltennamen auflösen statt feste Spaltenpositionen anzunehmen - robuster
  // gegenüber umsortierten/zusätzlichen Spalten (z. B. ein wieder hochgeladener Export).
  const columnIndexByKey = new Map<keyof UserExcelRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = USER_EXCEL_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingKeys = USER_IMPORT_COLUMN_KEYS.filter((key) => !columnIndexByKey.has(key));
  if (missingKeys.length > 0) {
    const missingHeaders = USER_EXCEL_COLUMNS.filter((column) => missingKeys.includes(column.key)).map((c) => c.header);
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingHeaders.join(', ')}.` };
  }

  const organizations = await prisma.organization.findMany();
  const existingUsers = await prisma.user.findMany({
    select: { email: true, stbNr: true, homeOrganizationId: true },
  });

  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof UserExcelRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return String(row.getCell(colIndex).value ?? '').trim();
    };

    const firstName = getValue('firstName');
    const lastName = getValue('lastName');
    const email = getValue('email').toLowerCase();
    const stbNr = getValue('stbNr');
    const phone = getValue('phone');
    const orgName = getValue('homeOrganizationName');

    if (!firstName && !lastName && !email && !orgName) continue; // leere Zeile überspringen

    if (!firstName || !lastName || !email || !orgName) {
      errors.push(`Zeile ${rowNumber}: Vorname, Nachname, E-Mail und Heimat-Feuerwehr sind erforderlich.`);
      continue;
    }

    const organization = organizations.find(
      (org) =>
        org.name.toLowerCase() === orgName.toLowerCase() ||
        (org.shortName ?? '').toLowerCase() === orgName.toLowerCase(),
    );
    if (!organization) {
      errors.push(`Zeile ${rowNumber}: Feuerwehr "${orgName}" wurde nicht gefunden.`);
      continue;
    }

    if (phone && !E164_PHONE_REGEX.test(phone)) {
      errors.push(`Zeile ${rowNumber}: Telefonnummer "${phone}" ist kein gültiges E.164-Format.`);
      continue;
    }

    // Duplikat-Erkennung laut Vorgabe: StbNr + Heimat-Feuerwehr.
    const isDuplicate =
      stbNr !== '' && existingUsers.some((u) => u.stbNr === stbNr && u.homeOrganizationId === organization.id);
    if (isDuplicate) {
      skipped++;
      continue;
    }

    if (existingUsers.some((u) => u.email === email)) {
      errors.push(`Zeile ${rowNumber}: E-Mail "${email}" ist bereits vergeben.`);
      continue;
    }

    try {
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
      const newUser = await prisma.user.create({
        data: {
          firstName,
          lastName,
          email,
          stbNr: stbNr || null,
          phone: phone || null,
          isActive: false,
          homeOrganizationId: organization.id,
          passwordHash,
        },
      });
      existingUsers.push({ email: newUser.email, stbNr: newUser.stbNr, homeOrganizationId: newUser.homeOrganizationId });
      created++;

      try {
        const token = await createToken(newUser.id, TokenPurpose.ACTIVATION);
        await sendActivationEmail(newUser, token);
      } catch (emailError) {
        console.error(`Aktivierungs-E-Mail für Zeile ${rowNumber} fehlgeschlagen:`, emailError);
        errors.push(`Zeile ${rowNumber}: Benutzer angelegt, aber Aktivierungs-E-Mail konnte nicht gesendet werden.`);
      }
    } catch (error) {
      console.error(`Import Zeile ${rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${rowNumber}: Unerwarteter Fehler beim Anlegen.`);
    }
  }

  revalidatePath('/admin/benutzer');
  return { result: { created, skipped, errors } };
}
