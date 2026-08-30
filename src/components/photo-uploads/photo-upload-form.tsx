'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { photoUploadSchema, PHOTO_UPLOAD_KINDS, PHOTO_UPLOAD_KIND_LABELS, type PhotoUploadInput } from '@/lib/validation/photo-upload.schema';
import type { PhotoUploadFormState } from '@/app/(app)/foto-uploads/actions';

interface PhotoUploadFormProps {
  fireDepartmentName: string;
  defaultValues?: Partial<PhotoUploadInput>;
  action: (prevState: PhotoUploadFormState, formData: FormData) => Promise<PhotoUploadFormState>;
  submitLabel: string;
}

function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function PhotoUploadForm({ fireDepartmentName, defaultValues, action, submitLabel }: PhotoUploadFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PhotoUploadInput>({
    resolver: zodResolver(photoUploadSchema),
    defaultValues: {
      kind: 'EINSATZ',
      description: '',
      occurredOn: todayIsoDate(),
      ...defaultValues,
    },
  });

  const kind = watch('kind');

  function onSubmit(values: PhotoUploadInput) {
    const formData = new FormData();
    formData.set('kind', values.kind);
    formData.set('description', values.description);
    formData.set('occurredOn', values.occurredOn);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5 pb-44 sm:pb-0">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Anlass</label>
        <div className="grid grid-cols-3 gap-2">
          {PHOTO_UPLOAD_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setValue('kind', option)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                kind === option ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-700'
              }`}
            >
              {PHOTO_UPLOAD_KIND_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Beschreibung</label>
        <input {...register('description')} placeholder="z. B. T2 – Verkehrsunfall B44" className="rounded border border-neutral-300 px-3 py-2" />
        {errors.description && <p className="text-sm text-red-700">{errors.description.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Datum</label>
        <input type="date" max={todayIsoDate()} {...register('occurredOn')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.occurredOn && <p className="text-sm text-red-700">{errors.occurredOn.message}</p>}
      </div>

      <p className="text-sm text-neutral-500">
        Jedes Mitglied der Feuerwehr {fireDepartmentName} darf Fotos zu diesem Einsatz hochladen und die eigenen wieder löschen. Durch das
        Hochladen werden Fotorechte an die Feuerwehr für die Veröffentlichung abgetreten.
      </p>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      {/* bottom-[98px] docks this bar directly above MobileTabBar - keep in sync with that
          component's own h-[98px]. */}
      <div className="fixed inset-x-0 bottom-[98px] z-40 flex justify-center border-t border-neutral-200 bg-white p-4 pb-safe-tabbar sm:static sm:bottom-0 sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex w-full max-w-lg items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-[52px] flex-1 rounded-lg bg-brand font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Speichern…' : submitLabel}
          </button>
          <Link href="/foto-uploads" className="text-sm text-neutral-600 hover:underline">
            Abbrechen
          </Link>
        </div>
      </div>
    </form>
  );
}
