import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { saveReportKioskDeviceName } from './report-kiosk-device-name';

const RUN = `kiosk-dev-${Date.now()}`;
const orgIds: string[] = [];
let feuerwehrId = '';
let abschnittId = '';

async function makeOrg(key: string, type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO') {
  const org = await prisma.organization.create({ data: { name: `${RUN}-${key}`, nummer: `${RUN}-${key}`, type } });
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  feuerwehrId = await makeOrg('ff', 'FEUERWEHR');
  abschnittId = await makeOrg('afkdo', 'ABSCHNITTSKOMMANDO');
});

afterAll(async () => {
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('saveReportKioskDeviceName', () => {
  it('speichert und entfernt den Namen', async () => {
    await saveReportKioskDeviceName(feuerwehrId, 'Tablet Feuerwehr EG');
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: feuerwehrId } })).reportKioskDeviceName).toBe('Tablet Feuerwehr EG');
    await saveReportKioskDeviceName(feuerwehrId, null);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: feuerwehrId } })).reportKioskDeviceName).toBeNull();
  });

  it('lehnt ein Abschnittskommando ab', async () => {
    await expect(saveReportKioskDeviceName(abschnittId, 'x')).rejects.toThrow('nur für aktive Feuerwehren');
  });
});
