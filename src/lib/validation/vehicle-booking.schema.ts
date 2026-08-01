import { z } from 'zod';

export const vehicleBookingSchema = z
  .object({
    vehicleId: z.string().min(1, 'Fahrzeug ist erforderlich.'),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
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
  };
}
