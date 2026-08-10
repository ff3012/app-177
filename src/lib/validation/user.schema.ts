import { z } from 'zod';

export const DRONE_ROLE_OPTIONS = ['NONE', 'PILOT', 'ADMIN'] as const;
export type DroneRoleOption = (typeof DRONE_ROLE_OPTIONS)[number];

/** E.164: "+" gefolgt von 2-15 Ziffern, erste Ziffer nicht 0. */
export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

export const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
    lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
    email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
    stbNr: z.string().trim().max(50).optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || E164_PHONE_REGEX.test(value), {
        message: 'Telefonnummer muss im E.164-Format sein (z. B. +436601234567).',
      })
      .optional()
      .or(z.literal('')),
    isActive: z.boolean(),
    istAtemschutzgeraeteTraeger: z.boolean(),
    dienstgradId: z.string().optional().or(z.literal('')),
    homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
    adminOrgIds: z.array(z.string()),
    droneRole: z.enum(DRONE_ROLE_OPTIONS),
    droneGroupId: z.string().nullable(),
    isBezirksAdmin: z.boolean(),
    isBezirksDrohnenAdmin: z.boolean(),
    sendWelcomeEmail: z.boolean(),
  })
  .refine((data) => !data.isBezirksDrohnenAdmin || data.droneRole === 'ADMIN', {
    message: 'Bezirks-Drohnenadmin erfordert die Rolle "Admin" in der zugeordneten Gruppe.',
    path: ['droneRole'],
  });

export type UserInput = z.infer<typeof userSchema>;

export function parseUserFormData(formData: FormData) {
  const rawDroneRole = String(formData.get('droneRole') ?? 'NONE');
  return {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    stbNr: String(formData.get('stbNr') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    isActive: formData.get('isActive') === 'on',
    istAtemschutzgeraeteTraeger: formData.get('istAtemschutzgeraeteTraeger') === 'on',
    dienstgradId: String(formData.get('dienstgradId') ?? ''),
    homeOrganizationId: String(formData.get('homeOrganizationId') ?? ''),
    adminOrgIds: formData.getAll('adminOrgIds').map(String),
    droneRole: (DRONE_ROLE_OPTIONS as readonly string[]).includes(rawDroneRole)
      ? (rawDroneRole as DroneRoleOption)
      : 'NONE',
    droneGroupId: (formData.get('droneGroupId') as string) || null,
    isBezirksAdmin: formData.get('isBezirksAdmin') === 'on',
    isBezirksDrohnenAdmin: formData.get('isBezirksDrohnenAdmin') === 'on',
    sendWelcomeEmail: formData.get('sendWelcomeEmail') === 'on',
  };
}
