'use server';

import { cookies } from 'next/headers';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createToken } from '@/lib/auth/tokens';
import { sendPasswordResetEmail } from '@/lib/email/templates';

export interface ForgotPasswordState {
  submitted?: boolean;
  error?: string;
}

const RATE_LIMIT_SECONDS = 30;
const COOKIE_NAME = 'pwreset_last_request';

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email) {
    return { error: 'E-Mail-Adresse ist erforderlich.' };
  }

  const now = Date.now();
  const cookieStore = await cookies();

  // Schutzebene 1: dieser Browser hat gerade erst einen Link angefordert (unabhängig von der E-Mail).
  const lastRequestCookie = cookieStore.get(COOKIE_NAME)?.value;
  const blockedByCookie = Boolean(lastRequestCookie) && now - Number(lastRequestCookie) < RATE_LIMIT_SECONDS * 1000;

  if (!blockedByCookie) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      // Schutzebene 2: für dieselbe E-Mail-Adresse nur alle 30 Sekunden ein neuer Link, unabhängig vom Browser.
      const recentToken = await prisma.passwordToken.findFirst({
        where: {
          userId: user.id,
          purpose: TokenPurpose.PASSWORD_RESET,
          createdAt: { gt: new Date(now - RATE_LIMIT_SECONDS * 1000) },
        },
      });

      if (!recentToken) {
        const token = await createToken(user.id, TokenPurpose.PASSWORD_RESET);
        try {
          await sendPasswordResetEmail(user, token);
        } catch (error) {
          console.error('Fehler beim Senden der Passwort-Reset-E-Mail:', error);
        }
      }
    }
  }

  cookieStore.set(COOKIE_NAME, String(now), {
    maxAge: RATE_LIMIT_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/passwort-vergessen',
  });

  // Bewusst immer dieselbe Antwort, egal ob die E-Mail existiert oder ob eine der beiden
  // Sperren gegriffen hat (kein Enumeration-Leak, kein Hinweis auf das Rate-Limit).
  return { submitted: true };
}
