/**
 * Testdaten für die Checkliste Drohnenflug - NUR für Entwicklungs-/Testumgebungen.
 *
 *   ALLOW_SEED_CHECKLIST=1 npx tsx prisma/seed-checklist.ts
 *
 * Legt für die Gruppe "AFKDO Purkersdorf" an: einen eigenen Entwurf (Schritt 4), einen fremden Entwurf, zwei
 * abgegebene Checklisten (je ein verknüpfter Flug) und eine verworfene. Alle Testchecklisten tragen das
 * Fluggebiet-Präfix "[Testdaten]" und werden bei jedem Lauf zuerst entfernt (idempotent). Drohnen und
 * Mitglieder werden NICHT erfunden, sondern aus der echten Gruppe übernommen. Die Benachrichtigungsadresse
 * wird nur gesetzt, wenn die Gruppe noch keine hat.
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = '[Testdaten]';
const TEST_MAIL = 'drohne177@ff.gv.at';

async function main() {
  if (process.env.ALLOW_SEED_CHECKLIST !== '1') {
    throw new Error('Abbruch: ALLOW_SEED_CHECKLIST=1 setzen (nur für Testumgebungen, niemals auf Produktion).');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Abbruch: NODE_ENV=production.');
  }

  const group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' } });
  const members = await prisma.user.findMany({
    where: { droneMembership: { droneGroupId: group.id }, isActive: true },
    orderBy: { lastName: 'asc' },
    take: 2,
    select: { id: true, firstName: true, lastName: true },
  });
  if (members.length < 2) throw new Error('Die Gruppe braucht mindestens zwei aktive Mitglieder.');
  const drones = await prisma.drone.findMany({ where: { droneGroupId: group.id, isActive: true }, orderBy: { sortOrder: 'asc' }, take: 2 });
  if (drones.length < 1) throw new Error('Die Gruppe braucht mindestens eine aktive Drohne.');
  const [me, other] = members;

  await prisma.droneGroup.update({
    where: { id: group.id },
    data: { featureChecklist: true, ...(group.flightNotificationEmails.length === 0 ? { flightNotificationEmails: [TEST_MAIL] } : {}) },
  });

  const old = await prisma.droneChecklist.findMany({ where: { droneGroupId: group.id, area: { startsWith: PREFIX } }, select: { id: true } });
  // Die vom Seed angelegten Testflüge (Ort mit Präfix) entfernen, übrige Verknüpfungen nur lösen.
  await prisma.droneFlight.deleteMany({ where: { location: { startsWith: PREFIX }, drone: { droneGroupId: group.id } } });
  await prisma.droneFlight.updateMany({ where: { checklistId: { in: old.map((o) => o.id) } }, data: { checklistId: null } });
  await prisma.droneChecklist.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

  const allChecked = Object.fromEntries(
    [...'p_gesund p_fs p_drohne p_licht p_verb p_kamera p_modus p_rthpos p_rthh p_akku30 p_akku20'.split(' '), ...'b_start b_schweb b_akku b_r360 b_l360 b_gr b_gl b_vor b_rueck b_land'.split(' ')].map((k) => [k, true]),
  );
  const day = (offsetDays: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);

  async function create(opts: {
    by: string;
    status: 'DRAFT' | 'SUBMITTED' | 'DISCARDED';
    area: string;
    step: number;
    when: Date;
    art: 'Einsatz' | 'Training';
    pilot: string;
    full: boolean;
  }) {
    const data: Prisma.InputJsonObject = {
      datum: dateOf(opts.when),
      zeit: '10:00',
      art: opts.art,
      gebiet: `${PREFIX} ${opts.area}`,
      drohnen: [drones[0].id],
      grundlage: 'open',
      openKat: 'A2',
      sicht: 'VLOS',
      hoehe: 60,
      pilot: opts.pilot,
      ...(opts.full ? { checks: allChecked, fluege: [{ akku: 'A1', uVor: '100', uNach: '62', start: '10:05', landung: '10:20', zw: true }], bestaetigt: true } : {}),
    };
    return prisma.droneChecklist.create({
      data: {
        droneGroupId: group.id,
        createdById: opts.by,
        pilotId: opts.pilot,
        status: opts.status,
        step: opts.step,
        flightAt: opts.when,
        purpose: opts.art === 'Einsatz' ? 'EINSATZ' : 'TRAINING',
        area: `${PREFIX} ${opts.area}`,
        data,
        drones: { create: [{ droneId: drones[0].id }] },
        ...(opts.status === 'SUBMITTED' ? { submittedAt: opts.when, confirmedAt: opts.when, submittedById: opts.by } : {}),
        ...(opts.status === 'DISCARDED' ? { discardedAt: opts.when } : {}),
      },
    });
  }

  await create({ by: me.id, status: 'DRAFT', area: 'Eigener Entwurf', step: 3, when: day(0), art: 'Training', pilot: me.id, full: false });
  await create({ by: other.id, status: 'DRAFT', area: 'Fremder Entwurf', step: 1, when: day(0, 8), art: 'Einsatz', pilot: other.id, full: false });
  const s1 = await create({ by: me.id, status: 'SUBMITTED', area: 'Steinbruch', step: 8, when: day(3), art: 'Training', pilot: me.id, full: true });
  const s2 = await create({ by: other.id, status: 'SUBMITTED', area: 'Hochwasser Wienfluss', step: 8, when: day(9), art: 'Einsatz', pilot: other.id, full: true });
  await create({ by: me.id, status: 'DISCARDED', area: 'Verworfen', step: 2, when: day(14), art: 'Training', pilot: me.id, full: false });

  for (const [checklist, pilot, art] of [
    [s1, me.id, 'UEBUNG'],
    [s2, other.id, 'EINSATZ'],
  ] as const) {
    await prisma.droneFlight.create({
      data: {
        startsAt: checklist.flightAt,
        pilotUserId: pilot,
        location: checklist.area ?? PREFIX,
        droneId: drones[0].id,
        purpose: art,
        registeredById: pilot,
        checklistId: checklist.id,
      },
    });
  }

  console.log(`Checkliste-Testdaten angelegt für "${group.name}" (Pilot: ${me.firstName} ${me.lastName}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
