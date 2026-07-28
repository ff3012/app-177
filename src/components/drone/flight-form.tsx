'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { flightSchema, type FlightInput } from '@/lib/validation/flight.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import type { FlightFormState } from '@/app/(app)/drohnen/actions';

interface DroneOption {
  id: string;
  name: string;
}

interface PilotOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface FlightFormProps {
  drones: DroneOption[];
  pilots: PilotOption[];
  defaultValues?: Partial<FlightInput>;
  action: (prevState: FlightFormState, formData: FormData) => Promise<FlightFormState>;
  submitLabel: string;
}

export function FlightForm({ drones, pilots, defaultValues, action, submitLabel }: FlightFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FlightInput>({
    resolver: zodResolver(flightSchema),
    defaultValues: {
      startsAt: '',
      pilotUserId: pilots[0]?.id ?? '',
      location: '',
      droneId: drones[0]?.id ?? '',
      purpose: 'UEBUNG',
      notes: '',
      ...defaultValues,
    },
  });

  function onSubmit(values: FlightInput) {
    const formData = new FormData();
    formData.set('startsAt', values.startsAt);
    formData.set('pilotUserId', values.pilotUserId);
    formData.set('location', values.location);
    formData.set('droneId', values.droneId);
    formData.set('purpose', values.purpose);
    formData.set('notes', values.notes ?? '');

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Datum/Uhrzeit</label>
        <Controller
          control={control}
          name="startsAt"
          render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
        />
        {errors.startsAt && <p className="text-sm text-red-700">{errors.startsAt.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Name Pilot</label>
        <select {...register('pilotUserId')} className="rounded border border-neutral-300 px-3 py-2">
          {pilots.map((pilot) => (
            <option key={pilot.id} value={pilot.id}>
              {pilot.firstName} {pilot.lastName}
            </option>
          ))}
        </select>
        {errors.pilotUserId && <p className="text-sm text-red-700">{errors.pilotUserId.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input {...register('location')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.location && <p className="text-sm text-red-700">{errors.location.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Drohne</label>
        <select {...register('droneId')} className="rounded border border-neutral-300 px-3 py-2">
          {drones.map((drone) => (
            <option key={drone.id} value={drone.id}>
              {drone.name}
            </option>
          ))}
        </select>
        {errors.droneId && <p className="text-sm text-red-700">{errors.droneId.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Zweck</label>
        <select {...register('purpose')} className="rounded border border-neutral-300 px-3 py-2">
          <option value="UEBUNG">Übung</option>
          <option value="EINSATZ">Einsatz</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Anmerkungen</label>
        <textarea {...register('notes')} rows={3} className="rounded border border-neutral-300 px-3 py-2" />
      </div>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? 'Speichern…' : submitLabel}
        </button>
        <Link href="/drohnen" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
