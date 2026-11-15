import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { saveNotificationFormRecipients } from '@/lib/heimatfeuerwehr/notification-form-settings';
import { viennaToday } from '@/lib/heimatfeuerwehr/notification-input';
import { sessionUserFixture } from '@/lib/mcp/tools/test-support';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));
const sessionState = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/lib/auth/session', () => ({ requireUser: vi.fn(async () => sessionState.user) }));

import { submitNotification } from './actions';

const RUN = `app-notif-${Date.now()}`;
let orgA = '';
let senderId = '';

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  senderId = (
    await prisma.user.create({ data: { email: `${RUN}-s@example.local`, passwordHash: 'x', firstName: 'App', lastName: RUN, homeOrganizationId: orgA } })
  ).id;
  sessionState.user = sessionUserFixture({ id: senderId, homeOrganizationId: orgA });
});

afterAll(async () => {
  if (senderId) await prisma.user.deleteMany({ where: { id: senderId } });
  if (orgA) await prisma.organization.deleteMany({ where: { id: orgA } });
});

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe('submitNotification (App)', () => {
  it('lehnt ab, solange die Feuerwehr keine Empfänger hinterlegt hat', async () => {
    const result = await submitNotification({ form: 'DRINKS', products: ['Bier'], note: null });
    expect(result.error).toBe('Dieses Formular ist nicht verfügbar.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sendet mit dem angemeldeten Benutzer als Absender der Heimatfeuerwehr', async () => {
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['r@example.local']);
    const result = await submitNotification({
      form: 'DAMAGE',
      occurredOn: viennaToday(),
      equipment: 'Schlauch',
      acute: null,
      description: 'Riss',
    });
    expect(result).toEqual({ ok: true });
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.to).toBe('r@example.local');
    expect(mail.replyTo).toBe(`${RUN}-s@example.local`);
  });
});
