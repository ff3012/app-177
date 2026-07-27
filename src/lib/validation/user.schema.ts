import { z } from 'zod';
import { passwordPolicySchema } from './password-policy';

export const userSchema = z.object({
  firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
  lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
  email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
  isActive: z.boolean(),
  homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
  adminOrgIds: z.array(z.string()),
  droneMember: z.boolean(),
  password: passwordPolicySchema.optional().or(z.literal('')),
});

export type UserInput = z.infer<typeof userSchema>;

export function parseUserFormData(formData: FormData) {
  return {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    isActive: formData.get('isActive') === 'on',
    homeOrganizationId: String(formData.get('homeOrganizationId') ?? ''),
    adminOrgIds: formData.getAll('adminOrgIds').map(String),
    droneMember: formData.get('droneMember') === 'on',
    password: String(formData.get('password') ?? ''),
  };
}
