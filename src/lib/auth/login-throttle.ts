import { prisma } from '@/lib/db/prisma';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface ThrottleStatus {
  locked: boolean;
  minutesRemaining?: number;
}

/** Prüft, ob für diese (roh eingegebene) E-Mail-Adresse aktuell eine Sperre aktiv ist. */
export async function checkLoginThrottle(email: string): Promise<ThrottleStatus> {
  const record = await prisma.loginAttempt.findUnique({ where: { email } });
  if (!record?.lockedUntil) {
    return { locked: false };
  }

  const now = Date.now();
  if (record.lockedUntil.getTime() <= now) {
    return { locked: false };
  }

  return { locked: true, minutesRemaining: Math.ceil((record.lockedUntil.getTime() - now) / 60_000) };
}

/**
 * Zählt einen Fehlversuch. Nach MAX_ATTEMPTS Fehlversuchen innerhalb von WINDOW_MS wird für
 * LOCKOUT_MS gesperrt. Getrackt pro E-Mail-String, unabhängig davon ob ein Konto existiert -
 * damit ein Lockout selbst keine Rückschlüsse auf die Existenz eines Accounts erlaubt.
 */
export async function recordFailedLogin(email: string): Promise<void> {
  const now = new Date();
  const existing = await prisma.loginAttempt.findUnique({ where: { email } });

  if (!existing || now.getTime() - existing.firstFailedAt.getTime() > WINDOW_MS) {
    await prisma.loginAttempt.upsert({
      where: { email },
      update: { failedCount: 1, firstFailedAt: now, lockedUntil: null },
      create: { email, failedCount: 1 },
    });
    return;
  }

  const failedCount = existing.failedCount + 1;
  const lockedUntil = failedCount >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null;

  await prisma.loginAttempt.update({
    where: { email },
    data: { failedCount, lockedUntil },
  });
}

/** Nach erfolgreichem Login: Zähler für diese E-Mail-Adresse zurücksetzen. */
export async function resetLoginAttempts(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email } });
}
