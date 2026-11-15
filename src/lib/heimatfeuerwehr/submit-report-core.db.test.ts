import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { submitReportCore, type SubmitReportInput } from './submit-report-core';
import { sendReportSubmittedEmail } from './notify-report-submitted';
import { saveReportTypeEnabled, saveReportTypeRecipients } from './report-type-settings';

// PDF, S3 und E-Mail sind nicht Gegenstand dieser Tests und dürfen mit einer lokalen .env nie echt auslösen.
vi.mock('@/lib/storage/report-pdf-s3', () => ({ putReportPdf: vi.fn(async () => undefined) }));
vi.mock('@/lib/heimatfeuerwehr/notify-report-submitted', () => ({
  sendReportSubmittedEmail: vi.fn(async () => ({ attempted: 0, failed: 0 })),
}));
vi.mock('@/lib/heimatfeuerwehr/report-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/heimatfeuerwehr/report-pdf')>()),
  generateReportPdf: vi.fn(async () => Buffer.from('pdf')),
}));

const RUN = `submit-core-${Date.now()}`;
const ids: Record<string, string> = {};
const vehicleIds: Record<string, string> = {};
let orgA = '';
let orgB = '';

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      stbNr: '4711',
      homeOrganizationId: organizationId,
      ...extra,
    },
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
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  await makeUser('creator', orgA);
  await makeUser('fillerA', orgA);
  await makeUser('memberA', orgA);
  await makeUser('fillerB', orgB);
  await makeUser('gone', orgA, { isActive: false, passwordChangedAt: new Date() });
  vehicleIds.a = (
    await prisma.vehicle.create({ data: { organizationId: orgA, taktischeBezeichnung: 'KLF', kennzeichen: `${RUN}-KA`, marke: 'M', typ: 'T' } })
  ).id;
  vehicleIds.b = (
    await prisma.vehicle.create({ data: { organizationId: orgB, taktischeBezeichnung: 'TLF', kennzeichen: `${RUN}-KB`, marke: 'M', typ: 'T' } })
  ).id;
});

afterAll(async () => {
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) {
    await prisma.report.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
    await prisma.reportSequence.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
    await prisma.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
  }
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('submitReportCore', () => {
  it('legt den Bericht mit Ersteller, Ausfüller und Feuerwehr an und liefert Nummer und Jahr', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({
        vehicles: [{ vehicleId: vehicleIds.a, km: 12 }],
        members: [{ userId: ids.memberA, funktion: 'FAHRER', vehicleId: vehicleIds.a }],
      }),
    });
    expect(result.error).toBeUndefined();
    expect(result.number).toBe(1);
    expect(result.year).toBe(new Date().getFullYear());

    const report = await prisma.report.findUniqueOrThrow({
      where: { id: result.reportId },
      include: { vehicles: true, members: true },
    });
    expect(report.fireDepartmentId).toBe(orgA);
    expect(report.createdById).toBe(ids.creator);
    expect(report.filledById).toBe(ids.fillerA);
    expect(report.vehicles).toHaveLength(1);
    expect(report.members).toHaveLength(1);
    expect(report.members[0].reportVehicleId).toBe(report.vehicles[0].id);
  });

  it('vergibt fortlaufende Nummern je Feuerwehr', async () => {
    const first = await submitReportCore({ fireDepartmentId: orgB, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    const second = await submitReportCore({ fireDepartmentId: orgB, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    expect(second.number).toBe((first.number ?? 0) + 1);
  });

  it('lehnt einen Ausfüller einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    expect(result.reportId).toBeUndefined();
  });

  it('lehnt einen bewusst deaktivierten Ausfüller ab', async () => {
    const result = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ filledById: ids.gone }) });
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt ein Fahrzeug einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ vehicles: [{ vehicleId: vehicleIds.b, km: 1 }] }),
    });
    expect(result.error).toBe('Mindestens ein ausgewähltes Fahrzeug gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt ein eingesetztes Mitglied einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ members: [{ userId: ids.fillerB, funktion: 'MANNSCHAFT', vehicleId: null }] }),
    });
    expect(result.error).toBe('Mindestens ein eingesetztes Mitglied gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt einen Übungsleiter einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ type: 'EXERCISE', uebungsleiterId: ids.fillerB }),
    });
    expect(result.error).toBe('Übungsleiter/-überwachung/-beobachter muss zu dieser Feuerwehr gehören.');
  });

  it('verlangt eine Bemerkung', async () => {
    const result = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ remark: '   ' }) });
    expect(result.error).toBe('Eine Bemerkung ist erforderlich.');
  });

  it('verlangt, dass das Ende nach dem Beginn liegt', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ startAt: '2030-06-15T10:00:00.000Z', endAt: '2030-06-15T08:00:00.000Z' }),
    });
    expect(result.error).toBe('Das Ende muss nach dem Beginn liegen.');
  });
});

describe('submitReportCore: Berichtsarten je Feuerwehr', () => {
  it('lehnt die nicht freigeschaltete Art INCIDENT und eine erfundene Art ab, ohne Bericht und ohne Nummer', async () => {
    const before = await prisma.report.count({ where: { fireDepartmentId: orgA } });
    for (const type of ['INCIDENT', 'FOO'] as const) {
      const result = await submitReportCore({
        fireDepartmentId: orgA,
        createdById: ids.creator,
        input: input({ type: type as never }),
      });
      expect(result.error).toBe('Diese Berichtsart ist nicht verfügbar.');
      expect(result.reportId).toBeUndefined();
    }
    expect(await prisma.report.count({ where: { fireDepartmentId: orgA } })).toBe(before);
  });

  it('lehnt eine von der Feuerwehr abgeschaltete Art ab und lässt die andere zu', async () => {
    await saveReportTypeEnabled(orgA, 'EXERCISE', false);
    try {
      const blocked = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'EXERCISE' }) });
      expect(blocked.error).toBe('Diese Berichtsart ist nicht verfügbar.');
      const allowed = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'ACTIVITY' }) });
      expect(allowed.error).toBeUndefined();
      expect(allowed.reportId).toBeDefined();
    } finally {
      await saveReportTypeEnabled(orgA, 'EXERCISE', true);
    }
  });

  it('nimmt die E-Mail-Empfänger aus der Zeile der Berichtsart', async () => {
    await saveReportTypeRecipients(orgA, 'ACTIVITY', ['taetigkeit@example.local']);
    await saveReportTypeRecipients(orgA, 'EXERCISE', ['uebung@example.local']);
    const mail = vi.mocked(sendReportSubmittedEmail);

    await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'ACTIVITY' }) });
    expect(mail.mock.calls.at(-1)?.[0].fireDepartmentEmails).toEqual(['taetigkeit@example.local']);

    await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'EXERCISE' }) });
    expect(mail.mock.calls.at(-1)?.[0].fireDepartmentEmails).toEqual(['uebung@example.local']);
  });

  it('ohne Zeile: keine Empfänger', async () => {
    const mail = vi.mocked(sendReportSubmittedEmail);
    await submitReportCore({ fireDepartmentId: orgB, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    expect(mail.mock.calls.at(-1)?.[0].fireDepartmentEmails).toEqual([]);
  });
});
