'use server';

import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createToken } from '@/lib/auth/tokens';
import { sendPasswordResetEmail } from '@/lib/email/templates';

export interface ForgotPasswordState {
  submitted?: boolean;
  error?: string;
}

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

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.isActive) {
    const token = await createToken(user.id, TokenPurpose.PASSWORD_RESET);
    try {
      await sendPasswordResetEmail(user, token);
    } catch (error) {
      console.error('Fehler beim Senden der Passwort-Reset-E-Mail:', error);
    }
  }

  // Bewusst immer dieselbe Antwort, egal ob die E-Mail existiert (kein Enumeration-Leak).
  return { submitted: true };
}
