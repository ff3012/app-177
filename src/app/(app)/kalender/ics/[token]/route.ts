import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildIcsCalendar } from '@/lib/calendar/ics';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const combinedToken = process.env.ABSCHNITTS_ICS_TOKEN;
  if (combinedToken && token === combinedToken) {
    const events = await prisma.event.findMany({ orderBy: { startsAt: 'asc' } });
    const body = buildIcsCalendar('Abschnitt Purkersdorf - Termine', events);
    return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  }

  const organization = await prisma.organization.findUnique({ where: { icsToken: token } });
  if (!organization) {
    return NextResponse.json({ error: 'Ungültiger Kalender-Link.' }, { status: 404 });
  }

  const events = await prisma.event.findMany({
    where: { OR: [{ organizationId: organization.id }, { isSectionWide: true }] },
    orderBy: { startsAt: 'asc' },
  });
  const body = buildIcsCalendar(`${organization.name} - Termine`, events);
  return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
