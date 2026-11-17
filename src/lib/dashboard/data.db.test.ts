import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getDashboardEvents } from './data';

const RUN = `dash-events-${Date.now()}`;
let orgId = '';
let userId = '';
let vehicleId = '';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `${RUN}-org`, nummer: `${RUN}-org`, type: 'ABSCHNITTSKOMMANDO' } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Dash', lastName: RUN, homeOrganizationId: orgId },
    })
  ).id;
  vehicleId = (
    await prisma.vehicle.create({
      data: { organizationId: orgId, taktischeBezeichnung: `${RUN}-BUS`, kennzeichen: `${RUN}-KZ`, marke: 'X', typ: 'Y' },
    })
  ).id;
  const booking = await prisma.vehicleBooking.create({
    data: { vehicleId, userId, startsAt: inDays(2), endsAt: inDays(2.1) },
  });
  await prisma.event.create({
    data: {
      title: `Fahrzeug: ${RUN}-BUS (Dash)`,
      startsAt: inDays(2),
      endsAt: inDays(2.1),
      organizationId: orgId,
      createdById: userId,
      vehicleBookingId: booking.id,
    },
  });
  await prisma.event.create({
    data: { title: `${RUN} Übung`, startsAt: inDays(3), endsAt: inDays(3.1), organizationId: orgId, createdById: userId },
  });
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { organizationId: orgId } });
  await prisma.vehicleBooking.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe('getDashboardEvents', () => {
  it('zeigt normale Termine, aber keine aus Fahrzeug-Buchungen erzeugten (die haben eine eigene Ansicht)', async () => {
    const titles = (await getDashboardEvents(orgId)).map((event) => event.title);
    expect(titles).toContain(`${RUN} Übung`);
    expect(titles.some((title) => title.startsWith('Fahrzeug: '))).toBe(false);
  });
});
