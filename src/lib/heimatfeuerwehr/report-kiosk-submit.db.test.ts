import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { clearReportKioskToken, setReportKioskToken } from './report-kiosk-token';
import { isReportKioskEmail } from './report-kiosk-user';
import { KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS, kioskRateKey, submitReportForKiosk } from './report-kiosk-submit';
import type { SubmitReportInput } from './submit-report-core';

vi.mock('@/lib/storage/report-pdf-s3', () => ({ putReportPdf: vi.fn(async () => undefined) }));
vi.mock('@/lib/heimatfeuerwehr/notify-report-submitted', () => ({
  sendReportSubmittedEmail: vi.fn(async () => ({ attempted: 0, failed: 0 })),
}));
vi.mock('@/lib/heimatfeuerwehr/report-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/heimatfeuerwehr/report-pdf')>()),
  generateReportPdf: vi.fn(async () => Buffer.from('pdf')),
}));

const RUN = `kiosk-submit-${Date.now()}`;
const ids: Record<string, string> = {};
let orgA = '';
let orgB = '';
let abschnittId = '';
let kioskUserExistedBefore = false;

async function makeUser(key: string, organizationId: string) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, stbNr: '1', homeOrganizationId: organizationId },
  });
  ids[key] = user.id;
}

function input(over: Partial<SubmitReportInput> = {}): SubmitReportInput {
  return {
    type: 'ACTIVITY',
    filledById: ids.fillerA,
    startAt: '2030-06-15T08:00:00.000Z',
    endAt: '2030-06-15T10:00:00.000Z',
    ownActivity: true,
    activityKinds: [],
    activityOther: 'Test',
    vehicles: [],
    remark: 'Bemerkung',
    members: [],
    quantities: [],
    uebungsleiterId: null,
    uebungsueberwachungId: null,
    uebungsbeobachterId: null,
    uebungsortStrasse: null,
    uebungsortNr: null,
    uebungsortPlz: null,
    uebungsortOrt: null,
    weitereFeuerwehren: null,
    uebungsziel: null,
    uebungslage: null,
    uebungsdarstellung: null,
    fuerUebungVerstaendigen: null,
    uebungserkenntnis: null,
    uebungszielsetzung: null,
    vorschlaege: null,
    ...over,
  };
}

beforeAll(async () => {
  kioskUserExistedBefore = (await prisma.user.findUnique({ where: { email: 'berichte-schnellerfassung@system.local' } })) !== null;
  abschnittId = (await prisma.organization.create({ data: { name: `${RUN}-afkdo`, nummer: `${RUN}-afkdo`, type: 'ABSCHNITTSKOMMANDO' } })).id;
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  await makeUser('fillerA', orgA);
  await makeUser('fillerB', orgB);
});

afterAll(async () => {
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) {
    await prisma.report.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
    await prisma.reportSequence.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
  }
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (!kioskUserExistedBefore) await prisma.user.deleteMany({ where: { email: 'berichte-schnellerfassung@system.local' } });
  const allOrgIds = [orgA, orgB, abschnittId].filter((id) => id !== '');
  if (allOrgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: allOrgIds } } });
});

describe('submitReportForKiosk', () => {
  it('legt mit gültigem Link einen Bericht an: Ersteller ist der Platzhalter, Ausfüller die gewählte Person', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input());
    expect(result.error).toBeUndefined();
    expect(result.number).toBe(1);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: result.reportId }, include: { createdBy: true } });
    expect(report.fireDepartmentId).toBe(orgA);
    expect(report.filledById).toBe(ids.fillerA);
    expect(isReportKioskEmail(report.createdBy.email)).toBe(true);
  });

  it('lehnt einen unbekannten Link ab und legt nichts an', async () => {
    const before = await prisma.report.count({ where: { fireDepartmentId: { in: [orgA, orgB] } } });
    const result = await submitReportForKiosk('x'.repeat(32), input());
    expect(result.error).toBe('Die Schnellerfassung ist nicht mehr aktiv.');
    expect(await prisma.report.count({ where: { fireDepartmentId: { in: [orgA, orgB] } } })).toBe(before);
  });

  it('lehnt einen abgeschalteten Link ab (auch wenn die Seite noch offen war)', async () => {
    const token = await setReportKioskToken(orgA);
    await clearReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input());
    expect(result.error).toBe('Die Schnellerfassung ist nicht mehr aktiv.');
  });

  it('lehnt einen neu erzeugten (alten) Link ab', async () => {
    const alt = await setReportKioskToken(orgA);
    await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(alt, input());
    expect(result.error).toBe('Die Schnellerfassung ist nicht mehr aktiv.');
  });

  it('bindet die Abgabe an die Feuerwehr des Links: ein Ausfüller einer anderen Feuerwehr wird abgelehnt', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input({ filledById: ids.fillerB }));
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt den nicht freigeschalteten Einsatzbericht (INCIDENT) serverseitig ab und legt nichts an', async () => {
    const token = await setReportKioskToken(orgA);
    const before = await prisma.report.count({ where: { fireDepartmentId: orgA } });
    const result = await submitReportForKiosk(token, input({ type: 'INCIDENT' }));
    expect(result.error).toBe('Diese Berichtsart ist nicht verfügbar.');
    expect(result.reportId).toBeUndefined();
    expect(await prisma.report.count({ where: { fireDepartmentId: orgA } })).toBe(before);
  });

  it('lehnt eine erfundene Berichtsart ab', async () => {
    const token = await setReportKioskToken(orgA);
    const before = await prisma.report.count({ where: { fireDepartmentId: orgA } });
    const result = await submitReportForKiosk(token, input({ type: 'FOO' as never }));
    expect(result.error).toBe('Diese Berichtsart ist nicht verfügbar.');
    expect(result.reportId).toBeUndefined();
    expect(await prisma.report.count({ where: { fireDepartmentId: orgA } })).toBe(before);
  });

  it('lässt die freigeschaltete Berichtsart EXERCISE weiterhin zu', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input({ type: 'EXERCISE' }));
    expect(result.error).toBeUndefined();
    expect(result.reportId).toBeDefined();
  });

  it('begrenzt die Abgaben je Link', async () => {
    const token = await setReportKioskToken(orgB);
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
    const result = await submitReportForKiosk(token, input({ filledById: ids.fillerB }));
    expect(result.error).toBe('Zu viele Abgaben. Bitte später erneut versuchen.');
  });

  it('zählt unbekannte Links nicht gegen das Limit (kein Speicherwachstum durch Raten)', async () => {
    const unknown = 'y'.repeat(32);
    await submitReportForKiosk(unknown, input());
    // Der Zähler für diesen Schlüssel darf noch leer sein: das gesamte Kontingent ist frei.
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(unknown), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
  });
});
