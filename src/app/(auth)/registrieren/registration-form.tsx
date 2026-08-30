'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { OrgSearchSelect, type OrgSearchSelectOption } from '@/components/admin/org-search-select';
import { registrationSchema, type RegistrationInput } from '@/lib/validation/registration.schema';
import { submitRegistration, type RegistrationState } from './actions';

interface DienstgradOption {
  id: string;
  kurzform: string;
}

interface RegistrationFormProps {
  organizations: OrgSearchSelectOption[];
  dienstgrade: DienstgradOption[];
}

const initialState: RegistrationState = {};

export function RegistrationForm({ organizations, dienstgrade }: RegistrationFormProps) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<RegistrationState>(initialState);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrationInput>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      organizationId: '',
      firstName: '',
      lastName: '',
      stbNr: '',
      dienstgradId: '',
      email: '',
      confirmed: false,
    },
  });

  function onSubmit(values: RegistrationInput) {
    const formData = new FormData();
    formData.set('organizationId', values.organizationId);
    formData.set('firstName', values.firstName);
    formData.set('lastName', values.lastName);
    formData.set('stbNr', values.stbNr);
    formData.set('dienstgradId', values.dienstgradId ?? '');
    formData.set('email', values.email);
    formData.set('confirmed', String(values.confirmed));

    startTransition(async () => {
      const result = await submitRegistration(initialState, formData);
      setState(result);
    });
  }

  // Server-seitige fieldErrors kommen nur zustande, wenn die client-seitige Zod-Prüfung etwas
  // durchlässt, das der Server trotzdem ablehnt (z. B. eine zwischenzeitlich deaktivierte Feuerwehr)
  // - ohne diese Zeile blieb ein solcher Fehlschlag zuvor komplett unsichtbar: der Spinner stoppte,
  // aber nichts erklärte warum.
  const serverFieldError = state.fieldErrors
    ? Object.values(state.fieldErrors).flat().filter(Boolean)[0]
    : undefined;

  if (state.submitted) {
    return (
      <p className="text-sm text-neutral-700">
        Danke! Deine Anfrage ist eingegangen und wird von einem Admin deiner Feuerwehr geprüft. Du
        erhältst eine E-Mail, sobald dein Konto freigeschaltet ist.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Feuerwehr</label>
        <Controller
          control={control}
          name="organizationId"
          render={({ field }) => (
            <OrgSearchSelect
              id="organizationId"
              options={organizations}
              value={field.value}
              onChange={field.onChange}
              placeholder="Feuerwehr auswählen"
              triggerClassName="w-full"
            />
          )}
        />
        {errors.organizationId && <p className="text-sm text-red-700">{errors.organizationId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Vorname</label>
          <input {...register('firstName')} className="rounded border border-neutral-300 px-3 py-2" />
          {errors.firstName && <p className="text-sm text-red-700">{errors.firstName.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Nachname</label>
          <input {...register('lastName')} className="rounded border border-neutral-300 px-3 py-2" />
          {errors.lastName && <p className="text-sm text-red-700">{errors.lastName.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Standesbuchnummer</label>
        <input {...register('stbNr')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.stbNr && <p className="text-sm text-red-700">{errors.stbNr.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Dienstgrad</label>
        <select {...register('dienstgradId')} className="rounded border border-neutral-300 px-3 py-2">
          <option value="">–</option>
          {dienstgrade.map((d) => (
            <option key={d.id} value={d.id}>
              {d.kurzform}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">E-Mail</label>
        <input type="email" {...register('email')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.email && <p className="text-sm text-red-700">{errors.email.message}</p>}
      </div>

      <div className="flex items-start gap-2">
        <input type="checkbox" id="confirmed" {...register('confirmed')} className="mt-1" />
        <label htmlFor="confirmed" className="text-sm text-neutral-700">
          Ich bestätige, dass diese Angaben korrekt sind und ich Mitglied dieser Feuerwehr bin.
        </label>
      </div>
      {errors.confirmed && <p className="text-sm text-red-700">{errors.confirmed.message}</p>}

      {(state.error || serverFieldError) && (
        <p className="text-sm text-red-700">{state.error || serverFieldError}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Wird gesendet…' : 'Registrieren'}
      </button>
    </form>
  );
}
