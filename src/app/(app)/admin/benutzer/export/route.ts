import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { MembershipRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { USER_EXCEL_COLUMNS } from '@/lib/admin/user-excel-columns';
import { getUserStatus } from '@/lib/auth/user-status';

const STATUS_LABEL = { AKTIV: 'Aktiv', INAKTIV: 'Inaktiv', DEAKTIVIERT: 'Deaktiviert' } as const;

export async function GET() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  // Bewusst kein isActive-Filter: der Report soll aktive UND deaktivierte Benutzer enthalten.
  const users = await prisma.user.findMany({
    include: {
      homeOrganization: true,
      memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
      droneMembership: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  // passwordChangedAt wird oben nicht selektiert, aber via include automatisch mitgeliefert (kein
  // eigener select-Block hier) - getUserStatus() unterscheidet damit "noch nie aktiviert" (Inaktiv)
  // von "war aktiv, wurde deaktiviert" (Deaktiviert), statt beides als "Deaktiviert" zu melden.

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Benutzer');
  sheet.columns = USER_EXCEL_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true };

  for (const u of users) {
    sheet.addRow({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      stbNr: u.stbNr ?? '',
      phone: u.phone ?? '',
      homeOrganizationName: u.homeOrganization.shortName ?? u.homeOrganization.name,
      adminFor: u.memberships.map((m) => m.organization.shortName ?? m.organization.name).join(', '),
      droneRole: u.droneMembership?.role === 'ADMIN' ? 'Admin' : u.droneMembership ? 'Mitglied' : '',
      status: STATUS_LABEL[getUserStatus(u)],
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="benutzer.xlsx"',
    },
  });
}
