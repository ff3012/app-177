'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { EVENT_CATEGORIES, eventSchema, type EventInput } from '@/lib/validation/event.schema';
import type { EventFormState } from '@/app/(app)/kalender/actions';

interface OrganizationOption {
  id: string;
  name: string;
  type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
}

interface EventFormProps {
  organizations: OrganizationOption[];
  canSectionWide: boolean;
  defaultValues?: Partial<EventInput>;
  action: (prevState: EventFormState, formData: FormData) => Promise<EventFormState>;
  submitLabel: string;
}

export function EventForm({ organizations, canSectionWide, defaultValues, action, submitLabel }: EventFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      allDay: false,
      organizationId: organizations[0]?.id ?? '',
      isSectionWide: false,
      category: 'ALLGEMEIN',
      ...defaultValues,
    },
  });

  const selectedOrgId = watch('organizationId');
  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);
  const showSectionWideOption = canSectionWide && selectedOrg?.type === 'ABSCHNITTSKOMMANDO';

  function onSubmit(values: EventInput) {
    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('description', values.description ?? '');
    formData.set('location', values.location ?? '');
    formData.set('startsAt', values.startsAt);
    formData.set('endsAt', values.endsAt);
    if (values.allDay) formData.set('allDay', 'on');
    formData.set('organizationId', values.organizationId);
    if (values.isSectionWide) formData.set('isSectionWide', 'on');
    formData.set('category', values.category);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Titel</label>
        <input {...register('title')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Beschreibung</label>
        <textarea {...register('description')} rows={3} className="rounded border border-neutral-300 px-3 py-2" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input {...register('location')} className="rounded border border-neutral-300 px-3 py-2" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Start</label>
          <input type="datetime-local" {...register('startsAt')} className="rounded border border-neutral-300 px-3 py-2" />
          {errors.startsAt && <p className="text-sm text-red-700">{errors.startsAt.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Ende</label>
          <input type="datetime-local" {...register('endsAt')} className="rounded border border-neutral-300 px-3 py-2" />
          {errors.endsAt && <p className="text-sm text-red-700">{errors.endsAt.message}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" {...register('allDay')} />
        Ganztägig
      </label>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Organisation</label>
        <select {...register('organizationId')} className="rounded border border-neutral-300 px-3 py-2">
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {errors.organizationId && <p className="text-sm text-red-700">{errors.organizationId.message}</p>}
      </div>

      {showSectionWideOption && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" {...register('isSectionWide')} />
          Abschnitt-weiter Termin (in allen Feuerwehr-Kalendern sichtbar)
        </label>
      )}

      {showSectionWideOption && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Kategorie</label>
          <select {...register('category')} className="rounded border border-neutral-300 px-3 py-2">
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category === 'DROHNENGRUPPE' ? 'Drohnengruppe' : 'Allgemein'}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            Kategorie "Drohnengruppe" ist nur für Mitglieder der Drohnengruppe sichtbar.
          </p>
        </div>
      )}

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? 'Speichern…' : submitLabel}
        </button>
        <Link href="/kalender" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
