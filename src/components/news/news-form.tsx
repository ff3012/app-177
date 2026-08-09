'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { newsSchema, type NewsInput } from '@/lib/validation/news.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import type { NewsFormState } from '@/app/(app)/news/actions';

interface OrganizationOption {
  id: string;
  name: string;
}

interface DroneGroupOption {
  id: string;
  name: string;
}

interface NewsFormProps {
  organizations: OrganizationOption[];
  droneGroups: DroneGroupOption[];
  action: (prevState: NewsFormState, formData: FormData) => Promise<NewsFormState>;
}

export function NewsForm({ organizations, droneGroups, action }: NewsFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NewsInput>({
    resolver: zodResolver(newsSchema),
    defaultValues: {
      title: '',
      body: '',
      audienceType: 'ORGANIZATION',
      audienceOrgId: organizations[0]?.id ?? '',
      // '' = "Alle Gruppen" (mappt serverseitig auf null) - bewusst der Default, damit sich das
      // bisherige Verhalten (Versand an alle Drohnengruppen) nicht ändert, ohne dass jemand aktiv
      // eine konkrete Gruppe auswählt.
      audienceDroneGroupId: '',
      sendMode: 'NOW',
      scheduledAt: '',
    },
  });

  const audienceType = watch('audienceType');
  const sendMode = watch('sendMode');

  function onSubmit(values: NewsInput) {
    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('body', values.body);
    formData.set('audienceType', values.audienceType);
    formData.set('audienceOrgId', values.audienceOrgId ?? '');
    formData.set('audienceDroneGroupId', values.audienceDroneGroupId ?? '');
    formData.set('sendMode', values.sendMode);
    formData.set('scheduledAt', values.scheduledAt ?? '');

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
        <label className="text-sm font-medium text-neutral-700">Text</label>
        <textarea {...register('body')} rows={4} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.body && <p className="text-sm text-red-700">{errors.body.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Zielgruppe</label>
        <select {...register('audienceType')} className="rounded border border-neutral-300 px-3 py-2">
          <option value="ORGANIZATION">Feuerwehr (Heimatfeuerwehr)</option>
          <option value="DROHNENGRUPPE">Drohnengruppe</option>
        </select>
      </div>

      {audienceType === 'ORGANIZATION' && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Feuerwehr</label>
          <select {...register('audienceOrgId')} className="rounded border border-neutral-300 px-3 py-2">
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          {errors.audienceOrgId && <p className="text-sm text-red-700">{errors.audienceOrgId.message}</p>}
        </div>
      )}

      {audienceType === 'DROHNENGRUPPE' && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Drohnengruppe</label>
          <select {...register('audienceDroneGroupId')} className="rounded border border-neutral-300 px-3 py-2">
            <option value="">Alle Gruppen</option>
            {droneGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          {errors.audienceDroneGroupId && (
            <p className="text-sm text-red-700">{errors.audienceDroneGroupId.message}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Versand</label>
        <select {...register('sendMode')} className="rounded border border-neutral-300 px-3 py-2">
          <option value="NOW">Sofort senden</option>
          <option value="SCHEDULED">Terminieren</option>
        </select>
      </div>

      {sendMode === 'SCHEDULED' && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Datum/Uhrzeit</label>
          <Controller
            control={control}
            name="scheduledAt"
            render={({ field }) => (
              <DateTime15MinInput value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
          {errors.scheduledAt && <p className="text-sm text-red-700">{errors.scheduledAt.message}</p>}
        </div>
      )}

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? 'Wird gespeichert…' : sendMode === 'NOW' ? 'Jetzt senden' : 'Terminieren'}
        </button>
        <Link href="/news" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
