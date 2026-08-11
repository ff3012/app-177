import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const allowedGroups = await getAllowedDroneGroups(user);
  if (allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const requestedGroupId = request.nextUrl.searchParams.get('gruppe');
  const droneGroupId = (requestedGroupId && allowedGroups.find((g) => g.id === requestedGroupId)?.id) || allowedGroups[0].id;

  const flights = await prisma.droneFlight.findMany({
    where: { drone: { droneGroupId } },
    include: { drone: true, registeredBy: true, pilotUser: true },
    orderBy: { startsAt: 'desc' },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Drohnenflüge');
  sheet.columns = [
    { header: 'Datum/Uhrzeit', key: 'startsAt', width: 20 },
    { header: 'Pilot', key: 'pilotName', width: 22 },
    { header: 'Ort', key: 'location', width: 22 },
    { header: 'Drohne', key: 'drone', width: 16 },
    { header: 'Zweck', key: 'purpose', width: 12 },
    { header: 'Erstellt von', key: 'registeredBy', width: 22 },
    { header: 'Anmerkungen', key: 'notes', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const flight of flights) {
    sheet.addRow({
      startsAt: flight.startsAt.toLocaleString('de-AT'),
      pilotName: `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`,
      location: flight.location,
      drone: flight.drone.name,
      purpose: PURPOSE_LABEL[flight.purpose] ?? flight.purpose,
      registeredBy: `${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`,
      notes: flight.notes ?? '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="drohnenfluege.xlsx"',
    },
  });
}
