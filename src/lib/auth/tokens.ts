import crypto from 'crypto';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const LOGIN_TTL_MS = 5 * 60 * 1000;

const TTL_BY_PURPOSE: Record<TokenPurpose, number> = {
  [TokenPurpose.ACTIVATION]: ACTIVATION_TTL_MS,
  [TokenPurpose.PASSWORD_RESET]: PASSWORD_RESET_TTL_MS,
  [TokenPurpose.LOGIN]: LOGIN_TTL_MS,
};

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Erzeugt einen neuen One-Time-Token für den Benutzer und gibt den (rohen, ungehashten) Token zurück. */
export async function createToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const ttl = TTL_BY_PURPOSE[purpose];

  await prisma.passwordToken.create({
    data: {
      userId,
      token: hashToken(rawToken),
      purpose,
      expiresAt: new Date(Date.now() + ttl),
    },
  });

  return rawToken;
}

/**
 * Wie createToken, aber speziell für TokenPurpose.LOGIN: erzeugt zusätzlich einen 6-stelligen
 * Code (ebenfalls nur als Hash gespeichert) als Alternative zum langen Token - gedacht zum
 * Einfügen direkt in eine bereits geöffnete Seite (siehe login/actions.ts), da ein per Mail-App
 * geöffneter Link auf iOS immer in Safari landet, nie in einer bereits installierten Homescreen-PWA.
 * crypto.randomInt (nicht Math.random) für eine kryptographisch sichere Gleichverteilung.
 */
export async function createLoginToken(userId: string): Promise<{ token: string; shortCode: string }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const shortCode = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

  await prisma.passwordToken.create({
    data: {
      userId,
      token: hashToken(rawToken),
      shortCode: hashToken(shortCode),
      purpose: TokenPurpose.LOGIN,
      expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
    },
  });

  return { token: rawToken, shortCode };
}

/**
 * Verbraucht den 6-stelligen Login-Code für eine bestimmte E-Mail-Adresse. Anders als
 * consumeToken (dort reicht der Token allein, da praktisch nicht erratbar) braucht dieser Weg
 * zusätzlich die E-Mail-Adresse, weil ein 6-stelliger Code allein durchprobierbar wäre - die
 * Rate-Begrenzung dagegen übernimmt login-throttle.ts genau wie beim Passwort-Login, pro
 * E-Mail-Adresse, in confirmLoginWithToken.
 */
export async function consumeLoginTokenByShortCode(email: string, rawShortCode: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return null;
  }

  const record = await prisma.passwordToken.findFirst({
    where: {
      userId: user.id,
      shortCode: hashToken(rawShortCode),
      purpose: TokenPurpose.LOGIN,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!record) {
    return null;
  }

  const { count } = await prisma.passwordToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 0) {
    return null;
  }

  return user;
}

/** Prüft und verbraucht (einmalig) einen Token. Gibt den zugehörigen Benutzer zurück, oder null wenn ungültig/abgelaufen/bereits verwendet. */
export async function consumeToken(rawToken: string, purpose: TokenPurpose) {
  const record = await prisma.passwordToken.findUnique({
    where: { token: hashToken(rawToken) },
    include: { user: true },
  });

  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }

  // usedAt: null muss Teil der WHERE-Klausel des Updates selbst sein, nicht nur der vorherigen
  // Lese-Prüfung - sonst könnten zwei gleichzeitige Anfragen beide den Lese-Check bestehen, bevor
  // eine von beiden usedAt setzt (TOCTOU), und den Token doppelt verbrauchen. updateMany mit
  // usedAt: null in der WHERE-Klausel garantiert, dass nur genau eine gleichzeitige Anfrage
  // gewinnt (count === 1), jede weitere trifft auf 0 Zeilen (count === 0).
  const { count } = await prisma.passwordToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 0) {
    return null;
  }

  return record.user;
}
