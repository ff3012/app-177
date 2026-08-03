import { z } from 'zod';

export const vehicleBookingSchema = z
  .object({
    vehicleId: z.string().min(1, 'Fahrzeug ist erforderlich.'),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
    // Pflichtfeld beim Ausborgen, aber nur für Heimatfeuerwehr-Admins sichtbar (siehe Kommentar
    // auf VehicleBooking.details in schema.prisma) - die Pflicht wird ausschließlich hier erzwungen.
    details: z.string().trim().min(1, 'Details sind erforderlich.').max(500, 'Details dürfen maximal 500 Zeichen lang sein.'),
  })
  .refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: 'Ende muss nach dem Start liegen.',
    path: ['endsAt'],
  });

export type VehicleBookingInput = z.infer<typeof vehicleBookingSchema>;

export function parseVehicleBookingFormData(formData: FormData) {
  return {
    vehicleId: String(formData.get('vehicleId') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    details: String(formData.get('details') ?? ''),
  };
}
