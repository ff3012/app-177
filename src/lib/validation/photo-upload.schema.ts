import { z } from 'zod';

export const PHOTO_UPLOAD_KINDS = ['EINSATZ', 'UEBUNG', 'SONSTIGES'] as const;

export const PHOTO_UPLOAD_KIND_LABELS: Record<(typeof PHOTO_UPLOAD_KINDS)[number], string> = {
  EINSATZ: 'Einsatz',
  UEBUNG: 'Übung',
  SONSTIGES: 'Sonstiges',
};

export const photoUploadSchema = z.object({
  kind: z.enum(PHOTO_UPLOAD_KINDS),
  description: z.string().trim().min(1, 'Beschreibung ist erforderlich.').max(200),
  occurredOn: z
    .string()
    .min(1, 'Datum ist erforderlich.')
    .refine((value) => new Date(value).getTime() <= Date.now(), 'Datum darf nicht in der Zukunft liegen.'),
});

export type PhotoUploadInput = z.infer<typeof photoUploadSchema>;

export function parsePhotoUploadFormData(formData: FormData) {
  return {
    kind: String(formData.get('kind') ?? ''),
    description: String(formData.get('description') ?? ''),
    occurredOn: String(formData.get('occurredOn') ?? ''),
  };
}
