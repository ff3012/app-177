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

const MAX_TOKEN_REQUESTS = 3;
const TOKEN_REQUEST_WINDOW_MS = 5 * 60 * 1000;
const TOKEN_REQUEST_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Wie checkLoginThrottle/recordFailedLogin, aber für angeforderte E-Mail-Anmelde-Token/Codes
 * statt fehlgeschlagener Passwort-Versuche: maximal MAX_TOKEN_REQUESTS tatsächlich ausgestellte
 * Token innerhalb von TOKEN_REQUEST_WINDOW_MS, danach TOKEN_REQUEST_LOCKOUT_MS gesperrt. Ebenfalls
 * pro E-Mail-String getrackt, unabhängig davon ob ein Konto existiert, aus demselben Grund
 * (Lockout selbst darf nicht verraten, ob ein Account existiert).
 */
export async function checkLoginTokenThrottle(email: string): Promise<ThrottleStatus> {
  const record = await prisma.loginTokenRequestAttempt.findUnique({ where: { email } });
  if (!record?.lockedUntil) {
    return { locked: false };
  }

  const now = Date.now();
  if (record.lockedUntil.getTime() <= now) {
    return { locked: false };
  }

  return { locked: true, minutesRemaining: Math.ceil((record.lockedUntil.getTime() - now) / 60_000) };
}

/** Nur aufrufen, wenn tatsächlich ein neuer Token ausgestellt wurde (nicht bei jedem Formular-Submit). */
export async function recordLoginTokenRequest(email: string): Promise<void> {
  const now = new Date();
  const existing = await prisma.loginTokenRequestAttempt.findUnique({ where: { email } });

  if (!existing || now.getTime() - existing.firstRequestAt.getTime() > TOKEN_REQUEST_WINDOW_MS) {
    await prisma.loginTokenRequestAttempt.upsert({
      where: { email },
      update: { requestCount: 1, firstRequestAt: now, lockedUntil: null },
      create: { email, requestCount: 1 },
    });
    return;
  }

  // Atomares Increment auf DB-Ebene, aus demselben Grund wie in recordFailedLogin oben (siehe
  // dortiger Kommentar) - kein Lost-Update unter gleichzeitigen Anfragen.
  const updated = await prisma.loginTokenRequestAttempt.update({
    where: { email },
    data: { requestCount: { increment: 1 } },
  });

  if (updated.requestCount >= MAX_TOKEN_REQUESTS && !updated.lockedUntil) {
    await prisma.loginTokenRequestAttempt.update({
      where: { email },
      data: { lockedUntil: new Date(now.getTime() + TOKEN_REQUEST_LOCKOUT_MS) },
    });
  }
}

/** Nach erfolgreicher Anmeldung per Token/Code: Zähler für diese E-Mail-Adresse zurücksetzen. */
export async function resetLoginTokenThrottle(email: string): Promise<void> {
  await prisma.loginTokenRequestAttempt.deleteMany({ where: { email } });
}
