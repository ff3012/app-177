import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { OPERATION_CHECK_KEYS, PREFLIGHT_CHECK_KEYS, type ChecklistData } from './data';
import { deliverChecklist, loadChecklistPdfData } from './delivery';

const RUN = `ck-deliv-${Date.now()}`;
const allChecked = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, true]));

let group: { id: string; flightNotificationEmails: string[] };
let pilot: { id: string };
let admin: { id: string };
let drone: { id: string };
let homeOrganizationId: string;
const userIds: string[] = [];

async function makeUser(key: string, role: 'PILOT' | 'ADMIN') {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      homeOrganizationId,
      isActive: true,
      droneMembership: { create: { droneGroupId: group.id, role } },
    },
  });
  userIds.push(user.id);
  return user;
}

beforeAll(async () => {
  group = await prisma.droneGroup.findFirstOrThrow({
    where: { name: 'AFKDO Purkersdorf' },
    select: { id: true, flightNotificationEmails: true },
  });
  homeOrganizationId = (await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } })).id;
  pilot = await makeUser('pilot', 'PILOT');
  admin = await makeUser('admin', 'ADMIN');
  drone = await prisma.drone.create({ data: { name: `${RUN}-d1`, droneGroupId: group.id } });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await prisma.droneGroup.update({ where: { id: group.id }, data: { flightNotificationEmails: group.flightNotificationEmails } });
});

afterAll(async () => {
  await prisma.droneChecklist.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.drone.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.droneGroup.update({ where: { id: group.id }, data: { flightNotificationEmails: group.flightNotificationEmails } });
  await prisma.$disconnect();
});

async function submitted(overrides: { status?: 'DRAFT' | 'SUBMITTED'; submittedById?: string } = {}) {
  const data: ChecklistData = {
    datum: '2026-06-15',
    zeit: '10:00',
    art: 'Einsatz',
    gebiet: 'Steinbruch',
    drohnen: [drone.id],
    grundlage: 'open',
    openKat: 'A2',
    hoehe: 60,
    pilot: pilot.id,
    helfer: [admin.id],
    checks: { ...allChecked(PREFLIGHT_CHECK_KEYS), ...allChecked(OPERATION_CHECK_KEYS), p_gesund: false },
    kommentar15: 'Kopfschmerzen, Helfer übernimmt',
    fluege: [{ akku: 'A1', start: '10:05' }, { akku: 'A2' }],
    bestaetigt: true,
  };
  const row = await prisma.droneChecklist.create({
    data: {
      droneGroupId: group.id,
      createdById: pilot.id,
      pilotId: pilot.id,
      status: overrides.status ?? 'SUBMITTED',
      flightAt: new Date('2026-06-15T08:00:00Z'),
      purpose: 'EINSATZ',
      area: 'Steinbruch',
      submittedAt: new Date('2026-06-15T09:00:00Z'),
      submittedById: overrides.submittedById ?? pilot.id,
      drones: { create: [{ droneId: drone.id }] },
      data: data as unknown as Prisma.InputJsonValue,
    },
  });
  return row.id;
}

const setEmails = (emails: string[]) => prisma.droneGroup.update({ where: { id: group.id }, data: { flightNotificationEmails: emails } });
const reload = (id: string) => prisma.droneChecklist.findUniqueOrThrow({ where: { id } });

describe('loadChecklistPdfData', () => {
  it('löst Pilot, Helfer, Drohnen und Gruppe in Namen auf', async () => {
    const id = await submitted();
    const data = await loadChecklistPdfData(id);
    expect(data?.groupName).toBe('AFKDO Purkersdorf');
    expect(data?.pilotName).toBe(`pilot ${RUN}`);
    expect(data?.helferNames).toEqual([`admin ${RUN}`]);
    expect(data?.droneNames).toEqual([`${RUN}-d1`]);
    expect(data?.confirmedBy).toEqual({ name: `pilot ${RUN}`, forPilot: false });
  });

  it('kennzeichnet die Bestätigung durch einen Admin als "für Pilot"', async () => {
    const id = await submitted({ submittedById: admin.id });
    const data = await loadChecklistPdfData(id);
    expect(data?.confirmedBy).toEqual({ name: `admin ${RUN}`, forPilot: true });
  });

  it('liefert null für eine unbekannte Id', async () => {
    expect(await loadChecklistPdfData('gibt-es-nicht')).toBeNull();
  });
});

describe('deliverChecklist', () => {
  it('ohne gültige Adresse: Hinweis statt Versand, die Checkliste bleibt abgegeben', async () => {
    await setEmails([]);
    const id = await submitted();
    const result = await deliverChecklist(id);
    expect(result.outcome).toBe('no-recipients');
    const row = await reload(id);
    expect(row.status).toBe('SUBMITTED');
    expect(row.mailError).toBe('Keine Benachrichtigungs-Adresse');
    expect(row.mailedAt).toBeNull();
  });

  it('im log-Modus: nichts wird gesendet, die Verwaltung sieht den Testbetrieb', async () => {
    vi.stubEnv('MAIL_MODE', 'log');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await setEmails(['a@ff.gv.at', 'b@ff.gv.at']);
    const id = await submitted();
    const send = vi.fn();
    const result = await deliverChecklist(id, { send });
    expect(result.outcome).toBe('logged');
    expect(send).not.toHaveBeenCalled();
    const row = await reload(id);
    expect(row.mailedTo).toBe('a@ff.gv.at, b@ff.gv.at');
    expect(row.mailedAt).toBeNull();
    expect(row.mailError).toContain('MAIL_MODE=log');
    log.mockRestore();
  });

  it('im live-Modus: sendet an alle Adressen und speichert Empfänger und Zeitpunkt', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    await setEmails(['a@ff.gv.at', 'b@ff.gv.at']);
    const id = await submitted();
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await deliverChecklist(id, { send });
    expect(result.outcome).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
    const attachment = send.mock.calls[0][0].attachments[0];
    expect(attachment.filename).toBe('Checkliste_Drohnenflug_2026-06-15_Steinbruch.pdf');
    expect(attachment.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(send.mock.calls[0][0].subject).toBe('Checkliste Drohnenflug · Einsatz · Steinbruch · 15.06.2026 10:00');
    expect(send.mock.calls[0][0].textPart).toContain('Kopfschmerzen, Helfer übernimmt');
    const row = await reload(id);
    expect(row.mailedTo).toBe('a@ff.gv.at, b@ff.gv.at');
    expect(row.mailedAt).not.toBeNull();
    expect(row.mailError).toBeNull();
  });

  it('bei einem Fehler: mailError mit Anzahl, kein mailedAt, Status bleibt abgegeben', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setEmails(['a@ff.gv.at', 'b@ff.gv.at']);
    const id = await submitted();
    const send = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const result = await deliverChecklist(id, { send });
    expect(result.outcome).toBe('failed');
    const row = await reload(id);
    expect(row.status).toBe('SUBMITTED');
    expect(row.mailError).toBe('1 von 2 E-Mails fehlgeschlagen');
    expect(row.mailedAt).toBeNull();
    err.mockRestore();
  });

  it('erneutes Senden löscht den alten Fehler und nutzt die aktuelle Adresse', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    await setEmails([]);
    const id = await submitted();
    await deliverChecklist(id);
    await setEmails(['neu@ff.gv.at']);
    const send = vi.fn().mockResolvedValue(undefined);
    await deliverChecklist(id, { send });
    const row = await reload(id);
    expect(send.mock.calls[0][0].to).toBe('neu@ff.gv.at');
    expect(row.mailedTo).toBe('neu@ff.gv.at');
    expect(row.mailError).toBeNull();
  });

  it('versendet nie einen Entwurf', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    await setEmails(['a@ff.gv.at']);
    const id = await submitted({ status: 'DRAFT' });
    const send = vi.fn();
    const result = await deliverChecklist(id, { send });
    expect(result.outcome).toBe('not-submitted');
    expect(send).not.toHaveBeenCalled();
    expect((await reload(id)).mailedAt).toBeNull();
  });

  it('wirft nie, auch wenn der Versand selbst scheitert (Mailjet nicht konfiguriert)', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    vi.stubEnv('MAILJET_API_KEY', '');
    vi.stubEnv('MAILJET_API_SECRET', '');
    vi.stubEnv('MAILJET_FROM_EMAIL', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setEmails(['a@ff.gv.at']);
    const id = await submitted();
    await expect(deliverChecklist(id)).resolves.toMatchObject({ outcome: 'failed' });
    expect((await reload(id)).mailError).toBe('1 von 1 E-Mails fehlgeschlagen');
    err.mockRestore();
  });
});
