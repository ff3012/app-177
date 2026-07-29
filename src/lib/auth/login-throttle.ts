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

  // Atomares Increment auf DB-Ebene (SET failedCount = failedCount + 1) statt eines in
  // Anwendungscode berechneten Werts - sonst könnten gleichzeitige Fehlversuche denselben Stand
  // lesen und sich gegenseitig überschreiben (Lost-Update-Race), wodurch mehr Versuche möglich
  // wären als MAX_ATTEMPTS erlaubt. Die Sperr-Entscheidung liest bewusst den zurückgegebenen,
  // tatsächlichen Zählerstand nach dem Increment statt des vorherigen (potenziell veralteten) Reads.
  const updated = await prisma.loginAttempt.update({
    where: { email },
    data: { failedCount: { increment: 1 } },
  });

  if (updated.failedCount >= MAX_ATTEMPTS && !updated.lockedUntil) {
    await prisma.loginAttempt.update({
      where: { email },
      data: { lockedUntil: new Date(now.getTime() + LOCKOUT_MS) },
    });
  }
}

/** Nach erfolgreichem Login: Zähler für diese E-Mail-Adresse zurücksetzen. */
export async function resetLoginAttempts(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email } });
}
