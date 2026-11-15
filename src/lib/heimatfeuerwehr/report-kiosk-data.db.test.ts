import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { setReportKioskToken } from './report-kiosk-token';
import { loadKioskData } from './report-kiosk-data';

const RUN = `kiosk-data-${Date.now()}`;
const userIds: string[] = [];
let orgA = '';
let orgB = '';
let abschnittId = '';
let reportId = '';

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: `${RUN}-${key}`,
      stbNr: '777',
      phone: '0664 1234567',
      homeOrganizationId: organizationId,
      ...extra,
    },
  });
  userIds.push(user.id);
  return user.id;
}

beforeAll(async () => {
  abschnittId = (await prisma.organization.create({ data: { name: `${RUN}-afkdo`, nummer: `${RUN}-afkdo`, type: 'ABSCHNITTSKOMMANDO' } })).id;
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  const bauer = await makeUser('bauer', orgA);
  await makeUser('anton', orgA);
  await makeUser('fremd', orgB);
  await makeUser('gone', orgA, { isActive: false, passwordChangedAt: new Date() });
  await prisma.vehicle.create({ data: { organizationId: orgA, taktischeBezeichnung: 'KLF', kennzeichen: `${RUN}-K1`, marke: 'M', typ: 'T', isActive: true } });
  await prisma.vehicle.create({ data: { organizationId: orgA, taktischeBezeichnung: 'Alt', kennzeichen: `${RUN}-K2`, marke: 'M', typ: 'T', isActive: false } });
  await prisma.vehicle.create({ data: { organizationId: orgB, taktischeBezeichnung: 'Fremd', kennzeichen: `${RUN}-K3`, marke: 'M', typ: 'T' } });
  const report = await prisma.report.create({
    data: {
      number: 1, year: 2999, type: 'ACTIVITY', fireDepartmentId: orgA, filledById: bauer, createdById: bauer,
      startAt: new Date('2030-06-15T08:00:00Z'), endAt: new Date('2030-06-15T10:00:00Z'), ownActivity: true,
      activityKinds: ['KIND_X'], remark: 'x', submittedAt: new Date(),
    },
  });
  reportId = report.id;
});

afterAll(async () => {
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (reportId) await prisma.report.deleteMany({ where: { id: reportId } });
  if (orgIds.length > 0) await prisma.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const allOrgIds = [orgA, orgB, abschnittId].filter((id) => id !== '');
  if (allOrgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: allOrgIds } } });
});

describe('loadKioskData', () => {
  it('liefert null für einen unbekannten Link', async () => {
    expect(await loadKioskData('z'.repeat(32))).toBeNull();
  });

  it('liefert nur aktive Mitglieder und aktive Fahrzeuge der Feuerwehr des Links, alphabetisch', async () => {
    const token = await setReportKioskToken(orgA);
    const data = await loadKioskData(token);
    expect(data?.organization).toEqual({ id: orgA, name: `${RUN}-a` });
    expect(data?.members.map((m) => m.firstName)).toEqual(['anton', 'bauer']);
    expect(data?.vehicles.map((v) => v.taktischeBezeichnung)).toEqual(['KLF']);
  });

  it('gibt von den Mitgliedern nur Id und Namen aus - nie E-Mail, Stb-Nr. oder Telefon', async () => {
    const token = await setReportKioskToken(orgA);
    const data = await loadKioskData(token);
    for (const member of data?.members ?? []) {
      expect(Object.keys(member).sort()).toEqual(['firstName', 'id', 'lastName']);
    }
  });

  it('liefert "Zuletzt verwendet" je Berichtsart aus den Berichten der Feuerwehr', async () => {
    const token = await setReportKioskToken(orgA);
    const data = await loadKioskData(token);
    expect(data?.recentKindsByType.ACTIVITY).toEqual(['KIND_X']);
    expect(data?.recentKindsByType.EXERCISE).toEqual([]);
  });
});
