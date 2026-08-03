'use server';

import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { consumeToken } from '@/lib/auth/tokens';
import { signIn } from '@/lib/auth/auth.config';
import { isAuthError } from '@/lib/auth/is-auth-error';
import { hashPassword } from '@/lib/password';
import {
  parseSetPasswordFormData,
  setPasswordSchema,
  type SetPasswordState,
} from '@/lib/validation/set-password.schema';

export async function activateAccount(
  token: string,
  _prevState: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const parsed = setPasswordSchema.safeParse(parseSetPasswordFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const user = await consumeToken(token, TokenPurpose.ACTIVATION);
  if (!user) {
    return { error: 'Der Link ist ungültig oder abgelaufen. Bitte wende dich an die Verwaltung.' };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, isActive: true, passwordChangedAt: new Date() },
  });

  try {
    await signIn('credentials', {
      email: user.email,
      password: parsed.data.newPassword,
      redirectTo: '/meine-feuerwehr',
    });
    return {};
  } catch (error) {
    if (isAuthError(error)) {
      return { success: true };
    }
    throw error;
  }
}
