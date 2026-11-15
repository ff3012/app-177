import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  getEnabledReportTypes,
  getReportRecipients,
  getReportTypeSettings,
  isReportTypeEnabled,
  saveReportTypeEnabled,
  saveReportTypeRecipients,
} from './report-type-settings';

const RUN = `rts-${Date.now()}`;
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

describe('Berichtsarten-Einstellungen', () => {
  it('ohne Zeile: beide Arten eingeschaltet, keine Empfänger', async () => {
    expect(await getReportTypeSettings(feuerwehrId)).toEqual({
      ACTIVITY: { enabled: true, recipients: [] },
      EXERCISE: { enabled: true, recipients: [] },
    });
    expect(await getEnabledReportTypes(feuerwehrId)).toEqual(['ACTIVITY', 'EXERCISE']);
    expect(await isReportTypeEnabled(feuerwehrId, 'ACTIVITY')).toBe(true);
    expect(await getReportRecipients(feuerwehrId, 'ACTIVITY')).toEqual([]);
  });

  it('schaltet eine Art ab, die andere bleibt eingeschaltet', async () => {
    await saveReportTypeEnabled(feuerwehrId, 'EXERCISE', false);
    expect(await isReportTypeEnabled(feuerwehrId, 'EXERCISE')).toBe(false);
    expect(await isReportTypeEnabled(feuerwehrId, 'ACTIVITY')).toBe(true);
    expect(await getEnabledReportTypes(feuerwehrId)).toEqual(['ACTIVITY']);
    await saveReportTypeEnabled(feuerwehrId, 'EXERCISE', true);
    expect(await getEnabledReportTypes(feuerwehrId)).toEqual(['ACTIVITY', 'EXERCISE']);
  });

  it('speichert Empfänger je Art getrennt, ohne Doppelte, und lässt den Schalter unberührt', async () => {
    await saveReportTypeEnabled(feuerwehrId, 'ACTIVITY', false);
    await saveReportTypeRecipients(feuerwehrId, 'ACTIVITY', ['a@example.local', 'a@example.local', 'b@example.local']);
    await saveReportTypeRecipients(feuerwehrId, 'EXERCISE', ['c@example.local']);
    expect(await getReportRecipients(feuerwehrId, 'ACTIVITY')).toEqual(['a@example.local', 'b@example.local']);
    expect(await getReportRecipients(feuerwehrId, 'EXERCISE')).toEqual(['c@example.local']);
    expect(await isReportTypeEnabled(feuerwehrId, 'ACTIVITY')).toBe(false);
    await saveReportTypeEnabled(feuerwehrId, 'ACTIVITY', true);
    expect(await getReportRecipients(feuerwehrId, 'ACTIVITY')).toEqual(['a@example.local', 'b@example.local']);
  });

  it('lehnt nicht freigeschaltete Arten ab; der Einsatzbericht gilt nie als eingeschaltet', async () => {
    await expect(saveReportTypeEnabled(feuerwehrId, 'INCIDENT', true)).rejects.toThrow('nicht verfügbar');
    await expect(saveReportTypeRecipients(feuerwehrId, 'INCIDENT', ['x@example.local'])).rejects.toThrow('nicht verfügbar');
    expect(await isReportTypeEnabled(feuerwehrId, 'INCIDENT')).toBe(false);
    expect(await isReportTypeEnabled(feuerwehrId, 'FOO')).toBe(false);
    expect(await getReportRecipients(feuerwehrId, 'INCIDENT')).toEqual([]);
  });

  it('lehnt Organisationen ab, die keine Feuerwehr sind', async () => {
    await expect(saveReportTypeEnabled(abschnittId, 'ACTIVITY', false)).rejects.toThrow('nur für Feuerwehren');
    await expect(saveReportTypeRecipients(abschnittId, 'ACTIVITY', [])).rejects.toThrow('nur für Feuerwehren');
  });
});
