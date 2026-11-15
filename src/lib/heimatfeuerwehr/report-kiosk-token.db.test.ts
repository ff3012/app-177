import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  clearReportKioskToken,
  findOrganizationByKioskToken,
  setReportKioskToken,
} from './report-kiosk-token';

const RUN = `kiosk-token-${Date.now()}`;
const orgIds: string[] = [];
let feuerwehrId: string;
let abschnittId: string;
let inaktivId: string;

async function makeOrg(key: string, type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO', isActive = true) {
  const org = await prisma.organization.create({
    data: { name: `${RUN}-${key}`, nummer: `${RUN}-${key}`, type, isActive },
  });
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  feuerwehrId = await makeOrg('ff', 'FEUERWEHR');
  abschnittId = await makeOrg('afkdo', 'ABSCHNITTSKOMMANDO');
  inaktivId = await makeOrg('inaktiv', 'FEUERWEHR', false);
});

afterAll(async () => {
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('Link der Berichte-Schnellerfassung', () => {
  it('erzeugt einen Link, der die Feuerwehr auflöst', async () => {
    const token = await setReportKioskToken(feuerwehrId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await findOrganizationByKioskToken(token)).toEqual({ id: feuerwehrId, name: `${RUN}-ff` });
  });

  it('dreht den Link neu: der alte Wert ist sofort ungültig', async () => {
    const alt = await setReportKioskToken(feuerwehrId);
    const neu = await setReportKioskToken(feuerwehrId);
    expect(neu).not.toBe(alt);
    expect(await findOrganizationByKioskToken(alt)).toBeNull();
    expect(await findOrganizationByKioskToken(neu)).not.toBeNull();
  });

  it('schaltet ab: der Link löst nichts mehr auf', async () => {
    const token = await setReportKioskToken(feuerwehrId);
    await clearReportKioskToken(feuerwehrId);
    expect(await findOrganizationByKioskToken(token)).toBeNull();
    const row = await prisma.organization.findUnique({ where: { id: feuerwehrId }, select: { reportKioskToken: true } });
    expect(row?.reportKioskToken).toBeNull();
  });

  it('lehnt Abschnittskommandos und inaktive Feuerwehren ab', async () => {
    await expect(setReportKioskToken(abschnittId)).rejects.toThrow('nur für aktive Feuerwehren');
    await expect(setReportKioskToken(inaktivId)).rejects.toThrow('nur für aktive Feuerwehren');
  });

  it('löst einen Link nicht mehr auf, sobald die Feuerwehr deaktiviert wurde', async () => {
    const token = await setReportKioskToken(feuerwehrId);
    await prisma.organization.update({ where: { id: feuerwehrId }, data: { isActive: false } });
    try {
      expect(await findOrganizationByKioskToken(token)).toBeNull();
    } finally {
      await prisma.organization.update({ where: { id: feuerwehrId }, data: { isActive: true } });
    }
  });

  it('antwortet auf unbekannte oder formal falsche Werte mit null', async () => {
    expect(await findOrganizationByKioskToken('')).toBeNull();
    expect(await findOrganizationByKioskToken('x'.repeat(32))).toBeNull();
  });
});
