import { z } from 'zod';

export const DRONE_ROLE_OPTIONS = ['NONE', 'PILOT', 'ADMIN'] as const;
export type DroneRoleOption = (typeof DRONE_ROLE_OPTIONS)[number];

/** E.164: "+" gefolgt von 2-15 Ziffern, erste Ziffer nicht 0. */
export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

export const AUSBILDUNGSSTUFEN = [
  'a1a3LizenzAm',
  'a2LizenzAm',
  'stuetzpunktausbildungAm',
  'bos1AusbildungAm',
  'bos2AusbildungAm',
] as const;
export type Ausbildungsstufe = (typeof AUSBILDUNGSSTUFEN)[number];

export const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
    lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
    email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
    stbNr: z.string().trim().min(1, 'Standesbuchnummer ist erforderlich.').max(50),
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
    a1a3LizenzAm: z.string(),
    a2LizenzAm: z.string(),
    stuetzpunktausbildungAm: z.string(),
    bos1AusbildungAm: z.string(),
    bos2AusbildungAm: z.string(),
    isBezirksAdmin: z.boolean(),
    isBezirksDrohnenAdmin: z.boolean(),
    sendWelcomeEmail: z.boolean(),
  })
  .refine((data) => !data.isBezirksDrohnenAdmin || data.droneRole === 'ADMIN', {
    message: 'Bezirks-Drohnenadmin erfordert die Rolle "Admin" in der zugeordneten Gruppe.',
    path: ['droneRole'],
  })
  .refine((data) => data.droneRole === 'NONE' || !!data.droneGroupId, {
    message: 'Bitte eine Drohnengruppe wählen.',
    path: ['droneGroupId'],
  })
  .superRefine((data, ctx) => {
    let seenGap = false;
    for (const key of AUSBILDUNGSSTUFEN) {
      if (!data[key]) {
        seenGap = true;
      } else if (seenGap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Ausbildungsstufen müssen der Reihe nach abgeschlossen werden.',
          path: [key],
        });
        break;
      }
    }
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
    a1a3LizenzAm: String(formData.get('a1a3LizenzAm') ?? ''),
    a2LizenzAm: String(formData.get('a2LizenzAm') ?? ''),
    stuetzpunktausbildungAm: String(formData.get('stuetzpunktausbildungAm') ?? ''),
    bos1AusbildungAm: String(formData.get('bos1AusbildungAm') ?? ''),
    bos2AusbildungAm: String(formData.get('bos2AusbildungAm') ?? ''),
    isBezirksAdmin: formData.get('isBezirksAdmin') === 'on',
    isBezirksDrohnenAdmin: formData.get('isBezirksDrohnenAdmin') === 'on',
    sendWelcomeEmail: formData.get('sendWelcomeEmail') === 'on',
  };
}
