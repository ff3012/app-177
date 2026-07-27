import { z } from 'zod';
import { passwordPolicySchema } from './password-policy';

export const setPasswordSchema = z
  .object({
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1, 'Bitte Passwort bestätigen.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein.',
    path: ['confirmPassword'],
  });

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export interface SetPasswordState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

export function parseSetPasswordFormData(formData: FormData) {
  return {
    newPassword: String(formData.get('newPassword') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  };
}
