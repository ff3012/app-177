import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { saveNotificationFormRecipients } from './notification-form-settings';
import { clearReportKioskToken, setReportKioskToken } from './report-kiosk-token';
import { KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS, kioskRateKey } from './report-kiosk-submit';
import { submitNotificationForKiosk } from './report-kiosk-notification-submit';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));

const RUN = `kiosk-notif-${Date.now()}`;
const ids: Record<string, string> = {};
let orgA = '';
let orgB = '';

const input = () => ({ form: 'DRINKS', products: ['Bier'], note: null });

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  for (const [key, org] of [['senderA', orgA], ['senderB', orgB]] as const) {
    ids[key] = (
      await prisma.user.create({ data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: org } })
    ).id;
  }
  await saveNotificationFormRecipients(orgA, 'DRINKS', ['r@example.local']);
  await saveNotificationFormRecipients(orgB, 'DRINKS', ['r@example.local']);
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

describe('submitNotificationForKiosk', () => {
  it('sendet mit gültigem Link und Mitglied der Feuerwehr des Links', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitNotificationForKiosk(token, ids.senderA, input());
    expect(result).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('lehnt unbekannte, abgeschaltete und neu erzeugte Links ab', async () => {
    expect(await submitNotificationForKiosk('x'.repeat(32), ids.senderA, input())).toEqual({ error: 'Die Schnellerfassung ist nicht mehr aktiv.' });

    const token = await setReportKioskToken(orgA);
    await clearReportKioskToken(orgA);
    expect(await submitNotificationForKiosk(token, ids.senderA, input())).toEqual({ error: 'Die Schnellerfassung ist nicht mehr aktiv.' });

    const old = await setReportKioskToken(orgA);
    await setReportKioskToken(orgA);
    expect(await submitNotificationForKiosk(old, ids.senderA, input())).toEqual({ error: 'Die Schnellerfassung ist nicht mehr aktiv.' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('bindet die Abgabe an die Feuerwehr des Links: Mitglied einer anderen Feuerwehr wird abgelehnt', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitNotificationForKiosk(token, ids.senderB, input());
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('teilt das Limit mit den Berichten (derselbe Zähler je Link)', async () => {
    const token = await setReportKioskToken(orgB);
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
    const result = await submitNotificationForKiosk(token, ids.senderB, input());
    expect(result).toEqual({ error: 'Zu viele Abgaben. Bitte später erneut versuchen.' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('zählt unbekannte Links nicht gegen das Limit', async () => {
    const unknown = 'y'.repeat(32);
    await submitNotificationForKiosk(unknown, ids.senderA, input());
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(unknown), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
  });
});
