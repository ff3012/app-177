'use server';

import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/password';
import { changePasswordSchema, parseChangePasswordFormData } from '@/lib/validation/password-policy';

export interface ChangePasswordState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse(parseChangePasswordFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }

  const currentPasswordValid = await verifyPassword(data.currentPassword, dbUser.passwordHash);
  if (!currentPasswordValid) {
    return { fieldErrors: { currentPassword: ['Aktuelles Passwort ist falsch.'] } };
  }

  const passwordHash = await hashPassword(data.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  return { success: true };
}
