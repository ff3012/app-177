'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import Link from 'next/link';
import { Time15MinSelect } from '@/components/ui/time-15min-select';
import type { VehicleBookingFormState } from '../actions';

interface VehicleOption {
  id: string;
  taktischeBezeichnung: string;
  kennzeichen: string;
}

interface BookingFormValues {
  vehicleId: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface BookingFormProps {
  vehicles: VehicleOption[];
  action: (prevState: VehicleBookingFormState, formData: FormData) => Promise<VehicleBookingFormState>;
  initialVehicleId?: string;
}

export function BookingForm({ vehicles, action, initialVehicleId }: BookingFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<BookingFormValues>({
    defaultValues: { vehicleId: initialVehicleId ?? vehicles[0]?.id ?? '', date: '', startTime: '', endTime: '' },
  });

  function onSubmit(values: BookingFormValues) {
    if (!values.date || !values.startTime || !values.endTime) {
      setServerError('Datum, Start- und Ende-Uhrzeit sind erforderlich.');
      return;
    }
    if (values.endTime <= values.startTime) {
      setServerError('Ende muss nach dem Start liegen.');
      return;
    }

    const formData = new FormData();
    formData.set('vehicleId', values.vehicleId);
    formData.set('startsAt', `${values.date}T${values.startTime}`);
    formData.set('endsAt', `${values.date}T${values.endTime}`);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Fahrzeug</label>
        <select {...register('vehicleId')} className="rounded border border-neutral-300 px-3 py-2">
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.taktischeBezeichnung} ({vehicle.kennzeichen})
            </option>
          ))}
        </select>
        {errors.vehicleId && <p className="text-sm text-red-700">{errors.vehicleId.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Datum</label>
        <input
          type="date"
          required
          {...register('date')}
          className="rounded border border-neutral-300 px-3 py-2"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Start</label>
          <Controller
            control={control}
            name="startTime"
            render={({ field }) => (
              <Time15MinSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} label="Start-Uhrzeit" />
            )}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Ende</label>
          <Controller
            control={control}
            name="endTime"
            render={({ field }) => (
              <Time15MinSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} label="Ende-Uhrzeit" />
            )}
          />
        </div>
      </div>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? 'Speichern…' : 'Fahrzeug ausborgen'}
        </button>
        <Link href="/meine-feuerwehr" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
