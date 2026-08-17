import { z } from 'zod';

export const INCIDENT_KINDS = ['TECHNISCH', 'BRAND', 'SCHADSTOFF', 'SONSTIGES'] as const;

export const INCIDENT_KIND_LABELS: Record<(typeof INCIDENT_KINDS)[number], string> = {
  TECHNISCH: 'Technisch',
  BRAND: 'Brand',
  SCHADSTOFF: 'Schadstoff',
  SONSTIGES: 'Sonstiges',
};

export const incidentSchema = z
  .object({
    kind: z.enum(INCIDENT_KINDS),
    keyword: z.string().trim().min(1, 'Einsatzstichwort ist erforderlich.').max(200),
    location: z.string().trim().min(1, 'Ort ist erforderlich.').max(200),
    alarmedAt: z.string().min(1, 'Alarmzeit ist erforderlich.'),
    endedAt: z.string(),
    crewCount: z.string(),
    vehicleIds: z.array(z.string()),
    crewMemberIds: z.array(z.string()),
  })
  .refine((data) => new Date(data.alarmedAt).getTime() <= Date.now(), {
    message: 'Alarmzeit darf nicht in der Zukunft liegen.',
    path: ['alarmedAt'],
  })
  .refine((data) => !data.endedAt || new Date(data.endedAt).getTime() > new Date(data.alarmedAt).getTime(), {
    message: 'Ende muss nach der Alarmzeit liegen.',
    path: ['endedAt'],
  });

export type IncidentInput = z.infer<typeof incidentSchema>;

export function parseIncidentFormData(formData: FormData) {
  return {
    kind: String(formData.get('kind') ?? ''),
    keyword: String(formData.get('keyword') ?? ''),
    location: String(formData.get('location') ?? ''),
    alarmedAt: String(formData.get('alarmedAt') ?? ''),
    endedAt: String(formData.get('endedAt') ?? ''),
    crewCount: String(formData.get('crewCount') ?? ''),
    vehicleIds: formData.getAll('vehicleIds').map(String),
    crewMemberIds: formData.getAll('crewMemberIds').map(String),
  };
}
