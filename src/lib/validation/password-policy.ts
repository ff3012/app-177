import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MIN_CRITERIA = 3;

export const PASSWORD_CRITERIA = [
  { key: 'lowercase', label: 'Kleinbuchstabe (a-z)', test: (v: string) => /[a-z]/.test(v) },
  { key: 'uppercase', label: 'Großbuchstabe (A-Z)', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'digit', label: 'Ziffer (0-9)', test: (v: string) => /[0-9]/.test(v) },
  { key: 'special', label: 'Sonderzeichen', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

export function countPasswordCriteria(password: string): number {
  return PASSWORD_CRITERIA.filter((criterion) => criterion.test(password)).length;
}

export function meetsPasswordPolicy(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && countPasswordCriteria(password) >= PASSWORD_MIN_CRITERIA;
}

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Mindestens ${PASSWORD_MIN_LENGTH} Zeichen.`)
  .refine(meetsPasswordPolicy, {
    message: `Mindestens ${PASSWORD_MIN_CRITERIA} von 4 Kriterien: Kleinbuchstabe, Großbuchstabe, Ziffer, Sonderzeichen.`,
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Aktuelles Passwort ist erforderlich.'),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1, 'Bitte Passwort bestätigen.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein.',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export function parseChangePasswordFormData(formData: FormData) {
  return {
    currentPassword: String(formData.get('currentPassword') ?? ''),
    newPassword: String(formData.get('newPassword') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  };
}
