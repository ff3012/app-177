import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getOrCreateReportKioskUser, isReportKioskEmail } from './report-kiosk-user';

const RUN = `kiosk-user-${Date.now()}`;
let abschnittId: string | null = null;
let userExistedBefore = false;

beforeAll(async () => {
  userExistedBefore = (await prisma.user.findUnique({ where: { email: 'berichte-schnellerfassung@system.local' } })) !== null;
  const org = await prisma.organization.create({ data: { name: `${RUN}-afkdo`, nummer: `${RUN}-afkdo`, type: 'ABSCHNITTSKOMMANDO' } });
  abschnittId = org.id;
});

afterAll(async () => {
  if (!userExistedBefore) {
    await prisma.user.deleteMany({ where: { email: 'berichte-schnellerfassung@system.local' } });
  }
  if (abschnittId) await prisma.organization.deleteMany({ where: { id: abschnittId } });
});

describe('getOrCreateReportKioskUser', () => {
  it('legt einen nicht anmeldbaren Platzhalter an und liefert beim zweiten Aufruf denselben', async () => {
    const first = await getOrCreateReportKioskUser();
    const second = await getOrCreateReportKioskUser();
    expect(second.id).toBe(first.id);
    expect(first.isActive).toBe(false);
    expect(isReportKioskEmail(first.email)).toBe(true);
  });

  it('übersteht zwei gleichzeitige erste Aufrufe', async () => {
    const [a, b] = await Promise.all([getOrCreateReportKioskUser(), getOrCreateReportKioskUser()]);
    expect(a.id).toBe(b.id);
  });
});

describe('isReportKioskEmail', () => {
  it('erkennt nur die Platzhalter-Adresse', () => {
    expect(isReportKioskEmail('berichte-schnellerfassung@system.local')).toBe(true);
    expect(isReportKioskEmail('max@example.at')).toBe(false);
  });
});
