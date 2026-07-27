import { z } from 'zod';

export const flightSchema = z.object({
  startsAt: z.string().min(1, 'Datum/Uhrzeit ist erforderlich.'),
  pilotName: z.string().trim().min(1, 'Name des Piloten ist erforderlich.').max(200),
  location: z.string().trim().min(1, 'Ort ist erforderlich.').max(200),
  droneId: z.string().min(1, 'Drohne ist erforderlich.'),
  purpose: z.enum(['UEBUNG', 'EINSATZ']),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export type FlightInput = z.infer<typeof flightSchema>;

export function parseFlightFormData(formData: FormData) {
  return {
    startsAt: String(formData.get('startsAt') ?? ''),
    pilotName: String(formData.get('pilotName') ?? ''),
    location: String(formData.get('location') ?? ''),
    droneId: String(formData.get('droneId') ?? ''),
    purpose: String(formData.get('purpose') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  };
}
