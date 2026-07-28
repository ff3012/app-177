import { z } from 'zod';

export const flightSchema = z.object({
  startsAt: z.string().min(1, 'Datum/Uhrzeit ist erforderlich.'),
  pilotUserId: z.string().min(1, 'Pilot ist erforderlich.'),
  location: z.string().trim().min(1, 'Ort ist erforderlich.').max(200),
  droneId: z.string().min(1, 'Drohne ist erforderlich.'),
  purpose: z.enum(['UEBUNG', 'EINSATZ']),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export type FlightInput = z.infer<typeof flightSchema>;

export function parseFlightFormData(formData: FormData) {
  return {
    startsAt: String(formData.get('startsAt') ?? ''),
    pilotUserId: String(formData.get('pilotUserId') ?? ''),
    location: String(formData.get('location') ?? ''),
    droneId: String(formData.get('droneId') ?? ''),
    purpose: String(formData.get('purpose') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  };
}
