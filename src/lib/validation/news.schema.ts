import { z } from 'zod';

export const NEWS_AUDIENCE_TYPES = ['ORGANIZATION', 'DROHNENGRUPPE'] as const;
export type NewsAudienceTypeOption = (typeof NEWS_AUDIENCE_TYPES)[number];

export const NEWS_SEND_MODES = ['NOW', 'SCHEDULED'] as const;
export type NewsSendMode = (typeof NEWS_SEND_MODES)[number];

export const newsSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(100),
    body: z.string().trim().min(1, 'Text ist erforderlich.').max(500),
    audienceType: z.enum(NEWS_AUDIENCE_TYPES),
    audienceOrgId: z.string().optional().or(z.literal('')),
    sendMode: z.enum(NEWS_SEND_MODES),
    scheduledAt: z.string().optional().or(z.literal('')),
  })
  .refine((data) => data.audienceType !== 'ORGANIZATION' || Boolean(data.audienceOrgId), {
    message: 'Feuerwehr ist erforderlich.',
    path: ['audienceOrgId'],
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
    audienceType: String(formData.get('audienceType') ?? 'ORGANIZATION'),
    audienceOrgId: String(formData.get('audienceOrgId') ?? ''),
    sendMode: String(formData.get('sendMode') ?? 'NOW'),
    scheduledAt: String(formData.get('scheduledAt') ?? ''),
  };
}
