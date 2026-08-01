import { z } from 'zod';

export const vehicleSchema = z.object({
  taktischeBezeichnung: z.string().trim().min(1, 'Taktische Bezeichnung ist erforderlich.').max(100),
  kennzeichen: z.string().trim().min(1, 'Kennzeichen ist erforderlich.').max(20),
  marke: z.string().trim().min(1, 'Marke ist erforderlich.').max(100),
  typ: z.string().trim().min(1, 'Typ ist erforderlich.').max(100),
});

export type VehicleInput = z.infer<typeof vehicleSchema>;

export function parseVehicleFormData(formData: FormData) {
  return {
    taktischeBezeichnung: String(formData.get('taktischeBezeichnung') ?? ''),
    kennzeichen: String(formData.get('kennzeichen') ?? ''),
    marke: String(formData.get('marke') ?? ''),
    typ: String(formData.get('typ') ?? ''),
  };
}
