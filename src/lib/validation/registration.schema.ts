import { z } from 'zod';

export const registrationSchema = z.object({
  organizationId: z.string().min(1, 'Feuerwehr ist erforderlich.'),
  firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
  lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
  stbNr: z
    .string()
    .trim()
    .min(1, 'Standesbuchnummer ist erforderlich.')
    .max(50)
    .regex(/^[1-9]\d*$/, 'Standesbuchnummer darf nur aus Ziffern bestehen und nicht mit 0 beginnen.'),
  dienstgradId: z.string().optional(),
  email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
  confirmed: z.boolean().refine((v) => v === true, {
    message: 'Bitte bestätige, dass die Angaben korrekt sind.',
  }),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export function parseRegistrationFormData(formData: FormData) {
  return {
    organizationId: formData.get('organizationId')?.toString() ?? '',
    firstName: formData.get('firstName')?.toString() ?? '',
    lastName: formData.get('lastName')?.toString() ?? '',
    stbNr: formData.get('stbNr')?.toString() ?? '',
    dienstgradId: formData.get('dienstgradId')?.toString() ?? '',
    email: formData.get('email')?.toString() ?? '',
    confirmed: formData.get('confirmed') === 'true',
  };
}
