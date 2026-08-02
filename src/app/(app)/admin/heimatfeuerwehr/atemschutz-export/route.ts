import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { getExpiryStatus, getFinnentestExpiryDate, type AtemschutzExpiryStatus } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { ATEMSCHUTZ_EXCEL_COLUMNS } from '@/lib/heimatfeuerwehr/atemschutz-excel-columns';

const STATUS_LABEL: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'Aktiv',
  laeuft_bald_ab: 'Läuft bald ab',
  abgelaufen: 'Abgelaufen',
  keine_angabe: 'Keine Angabe',
};

export async function GET(request: Request) {
  const user = await requireUser();
  const organizationId = new URL(request.url).searchParams.get('org');
  if (!organizationId || !canManageHeimatfeuerwehrFor(user, organizationId)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const members = await prisma.user.findMany({
    where: { homeOrganizationId: organizationId, isActive: true, istAtemschutzgeraeteTraeger: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      firstName: true,
      lastName: true,
      atemschutzUntersuchungAm: true,
      atemschutzGueltigBis: true,
      atemschutzFinnentestAm: true,
    },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Atemschutz');
  sheet.columns = ATEMSCHUTZ_EXCEL_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true };

  for (const member of members) {
    sheet.addRow({
      name: `${member.lastName} ${member.firstName}`,
      untersuchungAm: member.atemschutzUntersuchungAm?.toLocaleDateString('de-AT') ?? '',
      gueltigBis: member.atemschutzGueltigBis?.toLocaleDateString('de-AT') ?? '',
      finnentestAm: member.atemschutzFinnentestAm?.toLocaleDateString('de-AT') ?? '',
      statusUntersuchung: STATUS_LABEL[getExpiryStatus(member.atemschutzGueltigBis)],
      statusFinnentest: STATUS_LABEL[getExpiryStatus(getFinnentestExpiryDate(member.atemschutzFinnentestAm))],
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="atemschutz.xlsx"',
    },
  });
}
