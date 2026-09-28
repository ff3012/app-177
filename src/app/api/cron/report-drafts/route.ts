import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

/** Bericht-Brief.md §3 Einstieg A: "Endet eine Reservierung, wird automatisch ein Report(DRAFT,
 * reservationId) angelegt." Design-Spec §1 Punkt 3 legt den Mechanismus fest: ein periodischer Cron
 * (alle ~15 Min, gleiches Secret-Muster wie /api/cron/atemschutz-warnung), keine Auslösung bei
 * Seitenaufruf. Findet jede GENEHMIGT-Reservierung, deren Ende in den letzten 7 Tagen lag und die noch
 * keinen verknüpften Report hat (Report.vehicleBookingId ist @unique, daher reicht `report: null`). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  // Untere Schranke: nur Reservierungen, die in den letzten 7 Tagen geendet haben. Ohne sie würde der
  // allererste Lauf nach dem Deploy rückwirkend für JEDE je genehmigte Reservierung der gesamten
  // App-Historie einen Entwurf anlegen ("Big Bang"-Backfill) und die "Zu erledigen"-Liste aller
  // Betroffenen dauerhaft zumüllen. 7 Tage sind großzügig genug, um auch mehrtägige Cron-Ausfälle
  // aufzuholen.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endedBookings = await prisma.vehicleBooking.findMany({
    where: { status: 'GENEHMIGT', endsAt: { lt: now, gte: sevenDaysAgo }, report: null },
    include: { vehicle: { select: { organizationId: true } } },
  });

  let created = 0;
  for (const booking of endedBookings) {
    await prisma.report.create({
      data: {
        type: 'ACTIVITY',
        fireDepartmentId: booking.vehicle.organizationId,
        vehicleBookingId: booking.id,
        filledById: booking.userId,
        createdById: booking.userId,
        startAt: booking.startsAt,
        endAt: booking.endsAt,
        vehicleId: booking.vehicleId,
      },
    });
    created += 1;
  }

  return NextResponse.json({ ok: true, created, checkedAt: now.toISOString() });
}
