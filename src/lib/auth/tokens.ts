import crypto from 'crypto';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Erzeugt einen neuen One-Time-Token für den Benutzer und gibt den (rohen, ungehashten) Token zurück. */
export async function createToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const ttl = purpose === TokenPurpose.ACTIVATION ? ACTIVATION_TTL_MS : PASSWORD_RESET_TTL_MS;

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
