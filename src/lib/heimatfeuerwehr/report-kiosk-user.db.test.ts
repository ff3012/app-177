import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('übersteht zwei gleichzeitige erste Aufrufe (Unique-Konflikt P2002 wird abgefangen)', async () => {
    // Den Platzhalter gibt es sicher (erster Test bzw. schon vorhanden). Damit beide Aufrufe den
    // Create-Pfad betreten wie bei einem echten Rennen, meldet die erste Suche "nicht gefunden":
    // beide create()-Aufrufe scheitern am Unique-Index und müssen über den P2002-Zweig laden.
    const existing = await getOrCreateReportKioskUser();
    const findSpy = vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null as never);
    try {
      const [a, b] = await Promise.all([getOrCreateReportKioskUser(), getOrCreateReportKioskUser()]);
      expect(findSpy).toHaveBeenCalledTimes(2);
      expect(a.id).toBe(existing.id);
      expect(b.id).toBe(existing.id);
    } finally {
      findSpy.mockRestore();
    }
  });
});

describe('isReportKioskEmail', () => {
  it('erkennt nur die Platzhalter-Adresse', () => {
    expect(isReportKioskEmail('berichte-schnellerfassung@system.local')).toBe(true);
    expect(isReportKioskEmail('max@example.at')).toBe(false);
  });
});
