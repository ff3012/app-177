'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { incidentSchema, INCIDENT_KINDS, INCIDENT_KIND_LABELS, type IncidentInput } from '@/lib/validation/incident.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import type { IncidentFormState } from '@/app/(app)/meine-feuerwehr/einsaetze/actions';

interface VehicleOption {
  id: string;
  taktischeBezeichnung: string;
}

interface CrewMemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface IncidentFormProps {
  fireDepartmentName: string;
  vehicleOptions: VehicleOption[];
  crewMemberOptions: CrewMemberOption[];
  defaultValues?: Partial<IncidentInput>;
  action: (prevState: IncidentFormState, formData: FormData) => Promise<IncidentFormState>;
  submitLabel: string;
}

function MultiSelectChips({
  options,
  selectedIds,
  onChange,
}: {
  options: { id: string; label: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id]);
  }
  if (options.length === 0) return <p className="text-sm text-neutral-500">Keine Optionen vorhanden.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selectedIds.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => toggle(option.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              active ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-700'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function IncidentForm({
  fireDepartmentName,
  vehicleOptions,
  crewMemberOptions,
  defaultValues,
  action,
  submitLabel,
}: IncidentFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<IncidentInput>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      kind: 'TECHNISCH',
      keyword: '',
      location: '',
      alarmedAt: '',
      endedAt: '',
      crewCount: '',
      vehicleIds: [],
      crewMemberIds: [],
      ...defaultValues,
    },
  });

  const kind = watch('kind');
  const vehicleIds = watch('vehicleIds');
  const crewMemberIds = watch('crewMemberIds');

  function onSubmit(values: IncidentInput) {
    const formData = new FormData();
    formData.set('kind', values.kind);
    formData.set('keyword', values.keyword);
    formData.set('location', values.location);
    formData.set('alarmedAt', values.alarmedAt);
    formData.set('endedAt', values.endedAt ?? '');
    formData.set('crewCount', values.crewCount ?? '');
    for (const vehicleId of values.vehicleIds) formData.append('vehicleIds', vehicleId);
    for (const userId of values.crewMemberIds) formData.append('crewMemberIds', userId);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5 pb-24">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Einsatzart</label>
        <div className="grid grid-cols-2 gap-2">
          {INCIDENT_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setValue('kind', option)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                kind === option ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-700'
              }`}
            >
              {INCIDENT_KIND_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Einsatzstichwort</label>
        <input {...register('keyword')} placeholder="z. B. T2 – Verkehrsunfall" className="rounded border border-neutral-300 px-3 py-2" />
        {errors.keyword && <p className="text-sm text-red-700">{errors.keyword.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input {...register('location')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.location && <p className="text-sm text-red-700">{errors.location.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Alarmzeit</label>
          <Controller
            control={control}
            name="alarmedAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.alarmedAt && <p className="text-sm text-red-700">{errors.alarmedAt.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Ende (optional)</label>
          <Controller
            control={control}
            name="endedAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.endedAt && <p className="text-sm text-red-700">{errors.endedAt.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Fahrzeuge</label>
        <Controller
          control={control}
          name="vehicleIds"
          render={({ field }) => (
            <MultiSelectChips
              options={vehicleOptions.map((vehicle) => ({ id: vehicle.id, label: vehicle.taktischeBezeichnung }))}
              selectedIds={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Mannschaft</label>
        <input
          type="number"
          min={0}
          {...register('crewCount')}
          placeholder="Anzahl"
          className="w-32 rounded border border-neutral-300 px-3 py-2"
        />
        <Controller
          control={control}
          name="crewMemberIds"
          render={({ field }) => (
            <MultiSelectChips
              options={crewMemberOptions.map((member) => ({ id: member.id, label: `${member.firstName} ${member.lastName}` }))}
              selectedIds={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <p className="text-sm text-neutral-500">
        Jedes Mitglied der Feuerwehr {fireDepartmentName} darf Fotos zu diesem Einsatz hochladen und die eigenen wieder löschen.
      </p>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="fixed inset-x-0 bottom-0 flex justify-center border-t border-neutral-200 bg-white p-4 pb-safe-tabbar sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex w-full max-w-lg items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-[52px] flex-1 rounded-lg bg-brand font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Speichern…' : submitLabel}
          </button>
          <Link href="/meine-feuerwehr/einsaetze" className="text-sm text-neutral-600 hover:underline">
            Abbrechen
          </Link>
        </div>
      </div>

      <input type="hidden" value={vehicleIds.join(',')} readOnly />
      <input type="hidden" value={crewMemberIds.join(',')} readOnly />
    </form>
  );
}
