'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { DRONE_ROLE_OPTIONS, userSchema, type UserInput } from '@/lib/validation/user.schema';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import type { UserFormState } from '@/app/(app)/admin/benutzer/actions';

interface OrganizationOption {
  id: string;
  name: string;
}

interface UserFormProps {
  organizations: OrganizationOption[];
  defaultValues?: Partial<UserInput>;
  action: (prevState: UserFormState, formData: FormData) => Promise<UserFormState>;
  submitLabel: string;
  /** create: kein Passwort-Feld (Benutzer setzt es selbst über den Aktivierungs-Link). edit: optionales Passwort-Override + Aktiv-Schalter. */
  mode: 'create' | 'edit';
}

export function UserForm({ organizations, defaultValues, action, submitLabel, mode }: UserFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [activationLink, setActivationLink] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<UserInput>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      isActive: mode === 'create' ? false : true,
      homeOrganizationId: organizations[0]?.id ?? '',
      adminOrgIds: [],
      droneRole: 'NONE',
      password: '',
      sendWelcomeEmail: true,
      ...defaultValues,
    },
  });

  const sendWelcomeEmail = watch('sendWelcomeEmail');

  function onSubmit(values: UserInput) {
    const formData = new FormData();
    formData.set('firstName', values.firstName);
    formData.set('lastName', values.lastName);
    formData.set('email', values.email);
    if (values.isActive) formData.set('isActive', 'on');
    formData.set('homeOrganizationId', values.homeOrganizationId);
    for (const orgId of values.adminOrgIds) {
      formData.append('adminOrgIds', orgId);
    }
    formData.set('droneRole', values.droneRole);
    if (values.password) formData.set('password', values.password);
    if (values.sendWelcomeEmail) formData.set('sendWelcomeEmail', 'on');

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
      if (result?.success && result?.activationLink) {
        setActivationLink(result.activationLink);
      }
    });
  }

  if (activationLink) {
    return (
      <div className="flex max-w-lg flex-col gap-4 rounded border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">
          Benutzer wurde angelegt. Da keine Willkommen-E-Mail gesendet wurde, hier der Aktivierungslink zum
          manuellen Weitergeben:
        </p>
        <div className="flex items-start gap-2">
          <p className="flex-1 break-all rounded border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800">
            {activationLink}
          </p>
          <CopyLinkButton text={activationLink} />
        </div>
        <p className="text-xs text-neutral-500">Der Link ist 7 Tage gültig und einmalig verwendbar.</p>
        <div className="flex items-center gap-4">
          <Link href="/admin/benutzer" className="text-sm font-medium text-brand hover:underline">
            Zur Benutzerliste
          </Link>
          <button
            type="button"
            onClick={() => {
              reset();
              setActivationLink(undefined);
              setServerError(undefined);
            }}
            className="text-sm font-medium text-brand hover:underline"
          >
            Weiteren Benutzer anlegen
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <label className="text-sm font-medium text-neutral-700">E-Mail</label>
        <input type="email" {...register('email')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.email && <p className="text-sm text-red-700">{errors.email.message}</p>}
      </div>

      {mode === 'create' ? (
        <div className="flex flex-col gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
          <Controller
            control={control}
            name="sendWelcomeEmail"
            render={({ field }) => (
              <ToggleSwitch label="Willkommen-E-Mail senden" checked={field.value} onChange={field.onChange} />
            )}
          />
          <p className="text-sm text-neutral-600">
            {sendWelcomeEmail
              ? 'Der Benutzer erhält eine E-Mail mit einem Aktivierungslink und legt sein Passwort selbst fest.'
              : 'Es wird keine E-Mail versendet. Der Aktivierungslink wird nach dem Anlegen angezeigt, damit du ihn selbst weitergeben kannst.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Neues Passwort (optional)</label>
          <input type="password" {...register('password')} className="rounded border border-neutral-300 px-3 py-2" />
          <p className="text-xs text-neutral-500">
            Mindestens 8 Zeichen und 3 von 4: Kleinbuchstabe, Großbuchstabe, Ziffer, Sonderzeichen.
          </p>
          {errors.password && <p className="text-sm text-red-700">{errors.password.message}</p>}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Heimat-Feuerwehr / Organisation</label>
        <select {...register('homeOrganizationId')} className="rounded border border-neutral-300 px-3 py-2">
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {errors.homeOrganizationId && <p className="text-sm text-red-700">{errors.homeOrganizationId.message}</p>}
      </div>

      <fieldset className="flex flex-col gap-1 rounded border border-neutral-200 p-3">
        <legend className="px-1 text-sm font-medium text-neutral-700">Admin-Rechte für</legend>
        {organizations.map((org) => (
          <label key={org.id} className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" value={org.id} {...register('adminOrgIds')} />
            {org.name}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Drohnengruppe</label>
        <select {...register('droneRole')} className="rounded border border-neutral-300 px-3 py-2">
          {DRONE_ROLE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'NONE' ? 'Kein Mitglied' : option === 'ADMIN' ? 'Admin Drohnengruppe' : 'Mitglied'}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-500">
          Admin Drohnengruppe kann alle registrierten Flüge sehen, bearbeiten und löschen.
        </p>
      </div>

      {mode === 'edit' && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" {...register('isActive')} />
          Konto aktiv
        </label>
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
        <Link href="/admin/benutzer" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
