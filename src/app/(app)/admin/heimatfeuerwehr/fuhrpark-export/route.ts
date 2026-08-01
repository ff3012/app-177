import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { VEHICLE_EXCEL_COLUMNS } from '@/lib/heimatfeuerwehr/vehicle-excel-columns';

export async function GET(request: Request) {
  const user = await requireUser();
  const organizationId = new URL(request.url).searchParams.get('org');
  if (!organizationId || !canManageHeimatfeuerwehrFor(user, organizationId)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId },
    orderBy: { taktischeBezeichnung: 'asc' },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fuhrpark');
  sheet.columns = VEHICLE_EXCEL_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true };

  for (const vehicle of vehicles) {
    sheet.addRow({
      taktischeBezeichnung: vehicle.taktischeBezeichnung,
      kennzeichen: vehicle.kennzeichen,
      marke: vehicle.marke,
      typ: vehicle.typ,
      status: vehicle.isActive ? 'Aktiv' : 'Deaktiviert',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="fuhrpark.xlsx"',
    },
  });
}
