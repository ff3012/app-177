import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { saveNotificationFormEnabled, saveNotificationFormRecipients, saveDrinkProducts } from './notification-form-settings';
import { submitNotificationCore } from './submit-notification-core';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));

const RUN = `notif-core-${Date.now()}`;
const NOW = new Date('2026-11-15T11:13:00Z');
const ids: Record<string, string> = {};
let orgA = '';
let orgB = '';

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: organizationId, ...extra },
  });
  ids[key] = user.id;
}

const drinks = (over: Record<string, unknown> = {}) => ({ form: 'DRINKS', products: ['Bier'], note: null, ...over });
const damage = (over: Record<string, unknown> = {}) => ({
  form: 'DAMAGE',
  occurredOn: '2026-11-15',
  equipment: 'Atemschutzgerät 3',
  acute: true,
  description: 'Maske undicht',
  ...over,
});

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  await makeUser('senderA', orgA);
  await makeUser('senderB', orgB);
  await makeUser('gone', orgA, { isActive: false, passwordChangedAt: new Date() });
});

afterAll(async () => {
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe('submitNotificationCore: Verfügbarkeit', () => {
  it('lehnt ein Formular ohne Empfänger ab (norecipient)', async () => {
    const result = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks(), now: NOW });
    expect(result.error).toBe('Dieses Formular ist nicht verfügbar.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lehnt ein abgeschaltetes Formular ab und lässt das andere zu', async () => {
    await saveNotificationFormRecipients(orgA, 'DRINKS', ['a@example.local']);
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['b@example.local']);
    await saveNotificationFormEnabled(orgA, 'DRINKS', false);
    try {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks(), now: NOW })).error).toBe(
        'Dieses Formular ist nicht verfügbar.',
      );
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW })).ok).toBe(true);
    } finally {
      await saveNotificationFormEnabled(orgA, 'DRINKS', true);
    }
  });

  it('lehnt unbekannte Formulare ab', async () => {
    for (const input of [{ form: 'INCIDENT' }, { form: 'FOO' }, null, 'x']) {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input, now: NOW })).error).toBe(
        'Dieses Formular ist nicht verfügbar.',
      );
    }
  });
});

describe('submitNotificationCore: Absender und Felder', () => {
  it('lehnt einen Absender einer anderen Feuerwehr und einen deaktivierten Absender ab', async () => {
    const foreign = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderB, input: damage(), now: NOW });
    expect(foreign.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    const gone = await submitNotificationCore({ organizationId: orgA, senderId: ids.gone, input: damage(), now: NOW });
    expect(gone.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lehnt ein Produkt außerhalb der Produktliste der Feuerwehr ab und erlaubt eigene Produkte', async () => {
    expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks({ products: ['Wein'] }), now: NOW })).error).toBe(
      'Unbekanntes Produkt.',
    );
    await saveDrinkProducts(orgA, ['Cola', 'Wasser']);
    try {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks({ products: ['Bier'] }), now: NOW })).error).toBe(
        'Unbekanntes Produkt.',
      );
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks({ products: ['cola'] }), now: NOW })).ok).toBe(true);
    } finally {
      await saveDrinkProducts(orgA, []);
    }
  });

  it('lehnt ein Datum in der Zukunft, ein zu altes Datum und ungültige Längen ab', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ occurredOn: '2026-11-16' }, 'Das Datum darf nicht in der Zukunft liegen.'],
      [{ occurredOn: '2025-01-01' }, 'Das Datum liegt zu weit zurück.'],
      [{ equipment: 'a'.repeat(121) }, 'Gerät / Ausrüstung ist zu lang.'],
      [{ description: ' ' }, 'Bitte den Schaden beschreiben.'],
    ];
    for (const [over, error] of cases) {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(over), now: NOW })).error).toBe(error);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('submitNotificationCore: Versand', () => {
  it('sendet genau eine Mail je Empfänger mit Betreff, AKUT-Vorsatz und Reply-To', async () => {
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['r1@example.local', 'r2@example.local']);
    const result = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW });
    expect(result).toEqual({ ok: true });
    const calls = vi.mocked(sendEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.to)).toEqual(['r1@example.local', 'r2@example.local']);
    expect(calls[0].subject).toBe(`AKUT: Schadensmeldung: Atemschutzgerät 3 – ${RUN}-a`);
    expect(calls[0].replyTo).toBe(`${RUN}-senderA@example.local`);
    expect(calls[0].textPart).toContain('Gemeldet von: senderA');
  });

  it('meldet einen Fehler, wenn der Versand an ALLE Empfänger scheitert, aber nicht bei einem Teilausfall', async () => {
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['r1@example.local', 'r2@example.local']);
    vi.mocked(sendEmail).mockRejectedValue(new Error('mailjet down'));
    const total = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW });
    expect(total).toEqual({ error: 'Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.' });

    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('einer')).mockResolvedValue(undefined);
    const partial = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW });
    expect(partial).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
