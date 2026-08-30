import { prisma } from '@/lib/db/prisma';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function checkRegistrationThrottle(
  ipAddress: string,
): Promise<{ locked: boolean; minutesRemaining?: number }> {
  const attempt = await prisma.registrationAttempt.findUnique({ where: { ipAddress } });
  if (!attempt?.lockedUntil) {
    return { locked: false };
  }
  const now = new Date();
  if (attempt.lockedUntil <= now) {
    return { locked: false };
  }
  const minutesRemaining = Math.ceil((attempt.lockedUntil.getTime() - now.getTime()) / 60000);
  return { locked: true, minutesRemaining };
}

export async function recordRegistrationAttempt(ipAddress: string): Promise<void> {
  const now = new Date();
  const existing = await prisma.registrationAttempt.findUnique({ where: { ipAddress } });

  if (!existing || now.getTime() - existing.firstAttemptAt.getTime() > WINDOW_MS) {
    await prisma.registrationAttempt.upsert({
      where: { ipAddress },
      update: { attemptCount: 1, firstAttemptAt: now, lockedUntil: null },
      create: { ipAddress, attemptCount: 1 },
    });
    return;
  }

  const updated = await prisma.registrationAttempt.update({
    where: { ipAddress },
    data: { attemptCount: { increment: 1 } },
  });

  if (updated.attemptCount >= MAX_ATTEMPTS && !updated.lockedUntil) {
    await prisma.registrationAttempt.update({
      where: { ipAddress },
      data: { lockedUntil: new Date(now.getTime() + LOCKOUT_MS) },
    });
  }
}
