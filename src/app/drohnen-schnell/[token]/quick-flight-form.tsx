'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { flightSchema, type FlightInput } from '@/lib/validation/flight.schema';
import { registerFlightViaQuickLink, type QuickFlightFormState } from './actions';

interface DroneOption {
  id: string;
  name: string;
}

interface PilotOption {
  id: string;
  firstName: string;
  lastName: string;
}

function nowRoundedTo15Minutes(): string {
  const now = new Date();
  now.setMinutes(Math.floor(now.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function QuickFlightForm({ token, drones, pilots }: { token: string; drones: DroneOption[]; pilots: PilotOption[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<QuickFlightFormState>({});

  const defaultValues: FlightInput = {
    startsAt: nowRoundedTo15Minutes(),
    pilotUserId: pilots[0]?.id ?? '',
    location: '',
    droneId: drones[0]?.id ?? '',
    purpose: 'UEBUNG',
    notes: '',
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FlightInput>({ resolver: zodResolver(flightSchema), defaultValues });

  function onSubmit(values: FlightInput) {
    const formData = new FormData();
    formData.set('startsAt', values.startsAt);
    formData.set('pilotUserId', values.pilotUserId);
    formData.set('location', values.location);
    formData.set('droneId', values.droneId);
    formData.set('purpose', values.purpose);
    formData.set('notes', '');

    startTransition(async () => {
      const outcome = await registerFlightViaQuickLink(token, {}, formData);
      setResult(outcome);
      if (outcome.success) {
        reset({ ...defaultValues, startsAt: nowRoundedTo15Minutes() });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Datum/Uhrzeit</label>
        <input
          type="datetime-local"
          step={900}
          {...register('startsAt')}
          className="rounded border border-neutral-300 px-3 py-2"
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

      {result.error && <p className="text-sm text-red-700">{result.error}</p>}
      {result.success && <p className="text-sm font-medium text-green-700">Flug wurde registriert. Danke!</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Wird gespeichert…' : 'Flug registrieren'}
      </button>
    </form>
  );
}
