'use client';

import { useEffect, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { flightSchema, type FlightInput } from '@/lib/validation/flight.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import { getRememberedValues, rememberValue } from '@/lib/remembered-values';
import type { FlightFormState } from '@/app/(app)/drohnen/actions';
import { FlightChecklistPicker, type FlightChecklistChoice } from '@/components/drone/checklist/flight-checklist-picker';

// Aus einer Checkliste übernommene Felder werden hellgrün hinterlegt.
const ADOPTED = 'rounded-lg border border-[#9fd4b9] bg-[#f3faf6] p-2';

// Merkt bis zu 8 zuletzt verwendete, unterschiedliche Flugorte - eigener, vom Kalender-
// Termin-Formular getrennter Verlauf (siehe docs/superpowers/specs/2026-08-28-
// formular-vorschlaege-design.md).
const DRONE_FLIGHT_LOCATION_KEY = 'app177-drone-flight-locations';

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
  /** Nur gesetzt, wenn die Gruppe die Checkliste nutzt (Funktionsschalter an). */
  checklistChoices?: FlightChecklistChoice[];
  initialChecklistId?: string;
}

export function FlightForm({ drones, pilots, defaultValues, action, submitLabel, checklistChoices, initialChecklistId }: FlightFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [locations, setLocations] = useState<string[]>([]);
  const [checklistId, setChecklistId] = useState(initialChecklistId ?? '');
  const [adopted, setAdopted] = useState<string[]>([]);

  useEffect(() => {
    setLocations(getRememberedValues(DRONE_FLIGHT_LOCATION_KEY));
  }, []);

  const {
    register,
    control,
    handleSubmit,
    setValue,
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

  // Beim Öffnen mit ?checkliste=... einmalig vorbelegen.
  useEffect(() => {
    const initial = checklistChoices?.find((c) => c.id === initialChecklistId);
    if (initial) applyChecklist(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyChecklist(choice: FlightChecklistChoice | null) {
    if (!choice) {
      // "Ohne Checkliste" löst nur die Verknüpfung, die Feldwerte bleiben.
      setChecklistId('');
      setAdopted([]);
      return;
    }
    setChecklistId(choice.id);
    const d = choice.defaults;
    const taken: string[] = ['startsAt'];
    const opts = { shouldValidate: true, shouldDirty: true };
    setValue('startsAt', d.startsAt, opts);
    if (d.purpose) {
      setValue('purpose', d.purpose, opts);
      taken.push('purpose');
    }
    if (d.pilotUserId && pilots.some((p) => p.id === d.pilotUserId)) {
      setValue('pilotUserId', d.pilotUserId, opts);
      taken.push('pilotUserId');
    }
    if (d.location) {
      setValue('location', d.location, opts);
      taken.push('location');
    }
    if (d.droneId && drones.some((x) => x.id === d.droneId)) {
      setValue('droneId', d.droneId, opts);
      taken.push('droneId');
    }
    setAdopted(taken);
  }

  function onSubmit(values: FlightInput) {
    const formData = new FormData();
    formData.set('startsAt', values.startsAt);
    formData.set('pilotUserId', values.pilotUserId);
    formData.set('location', values.location);
    formData.set('droneId', values.droneId);
    formData.set('purpose', values.purpose);
    formData.set('notes', values.notes ?? '');
    if (checklistChoices) formData.set('checklistId', checklistId);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
      if (!result?.error) rememberValue(DRONE_FLIGHT_LOCATION_KEY, values.location, 8);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      {checklistChoices && <FlightChecklistPicker choices={checklistChoices} selectedId={checklistId} onSelect={applyChecklist} />}
      {adopted.length > 0 && <p className="text-[13px] text-[#1f6b4a]">Übernommen aus der Checkliste. Alles bleibt änderbar.</p>}
      <div className={`flex flex-col gap-1 ${adopted.includes('startsAt') ? ADOPTED : ''}`}>
        <label className="text-sm font-medium text-neutral-700">Datum/Uhrzeit</label>
        <Controller
          control={control}
          name="startsAt"
          render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
        />
        {errors.startsAt && <p className="text-sm text-red-700">{errors.startsAt.message}</p>}
      </div>

      <div className={`flex flex-col gap-1 ${adopted.includes('pilotUserId') ? ADOPTED : ''}`}>
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

      <div className={`flex flex-col gap-1 ${adopted.includes('location') ? ADOPTED : ''}`}>
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input
          {...register('location')}
          list="drone-flight-location-suggestions"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <datalist id="drone-flight-location-suggestions">
          {locations.map((location) => (
            <option key={location} value={location} />
          ))}
        </datalist>
        {/* Eigene Chip-Liste zusätzlich zum <datalist> oben: Android-WebView zeigt native
            <datalist>-Vorschläge oft gar nicht an (bestätigte Einschränkung, siehe
            docs/superpowers/specs/2026-08-28-formular-vorschlaege-design.md) - diese Buttons
            funktionieren unabhängig davon, da sie reines React sind. */}
        {locations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {locations.map((location) => (
              <button
                key={location}
                type="button"
                onClick={() => setValue('location', location, { shouldValidate: true })}
                className="rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                {location}
              </button>
            ))}
          </div>
        )}
        {errors.location && <p className="text-sm text-red-700">{errors.location.message}</p>}
      </div>

      <div className={`flex flex-col gap-1 ${adopted.includes('droneId') ? ADOPTED : ''}`}>
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

      <div className={`flex flex-col gap-1 ${adopted.includes('purpose') ? ADOPTED : ''}`}>
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
