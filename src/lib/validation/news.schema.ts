import { z } from 'zod';

export const NEWS_AUDIENCES = ['FIRE_DEPARTMENT', 'DRONE_GROUP'] as const;
export type NewsAudienceOption = (typeof NEWS_AUDIENCES)[number];

export const NEWS_SEND_MODES = ['DRAFT', 'SCHEDULED', 'NOW'] as const;
export type NewsSendMode = (typeof NEWS_SEND_MODES)[number];

export const newsSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(65),
    body: z.string().trim().min(1, 'Text ist erforderlich.'),
    audience: z.enum(NEWS_AUDIENCES),
    fireDepartmentId: z.string().optional().or(z.literal('')),
    // Leer bedeutet "Alle Gruppen" (mappt serverseitig auf null) - eine bewusst weiterhin gültige
    // Auswahl, kein Kompatibilitäts-Notbehelf (siehe NewsPost.droneGroupId im Schema).
    droneGroupId: z.string().nullable().optional().or(z.literal('')),
    eventId: z.string().optional().or(z.literal('')),
    sendMode: z.enum(NEWS_SEND_MODES),
    scheduledAt: z.string().optional().or(z.literal('')),
  })
  .refine((data) => data.audience !== 'FIRE_DEPARTMENT' || Boolean(data.fireDepartmentId), {
    message: 'Feuerwehr ist erforderlich.',
    path: ['fireDepartmentId'],
  })
  .refine((data) => data.sendMode !== 'SCHEDULED' || Boolean(data.scheduledAt), {
    message: 'Datum/Uhrzeit ist erforderlich.',
    path: ['scheduledAt'],
  });

export type NewsInput = z.infer<typeof newsSchema>;

export function parseNewsFormData(formData: FormData) {
  return {
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    audience: String(formData.get('audience') ?? 'FIRE_DEPARTMENT'),
    fireDepartmentId: String(formData.get('fireDepartmentId') ?? ''),
    droneGroupId: String(formData.get('droneGroupId') ?? ''),
    eventId: String(formData.get('eventId') ?? ''),
    sendMode: String(formData.get('sendMode') ?? 'DRAFT'),
    scheduledAt: String(formData.get('scheduledAt') ?? ''),
  };
}
