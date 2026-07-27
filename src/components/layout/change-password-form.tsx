'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  changePasswordSchema,
  countPasswordCriteria,
  PASSWORD_CRITERIA,
  PASSWORD_MIN_CRITERIA,
  PASSWORD_MIN_LENGTH,
  type ChangePasswordInput,
} from '@/lib/validation/password-policy';
import { changePassword } from '@/app/(app)/profile/actions';

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';
  const criteriaMet = countPasswordCriteria(newPassword);
  const lengthOk = newPassword.length >= PASSWORD_MIN_LENGTH;

  function onSubmit(values: ChangePasswordInput) {
    const formData = new FormData();
    formData.set('currentPassword', values.currentPassword);
    formData.set('newPassword', values.newPassword);
    formData.set('confirmPassword', values.confirmPassword);

    startTransition(async () => {
      const result = await changePassword({}, formData);
      if (result?.success) {
        setSuccess(true);
        setServerError(undefined);
        setServerFieldErrors({});
        reset();
      } else {
        setSuccess(false);
        setServerError(result?.error);
        setServerFieldErrors(result?.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">Aktuelles Passwort</label>
        <input
          type="password"
          {...register('currentPassword')}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        {errors.currentPassword && <p className="text-xs text-red-700">{errors.currentPassword.message}</p>}
        {serverFieldErrors.currentPassword?.map((message) => (
          <p key={message} className="text-xs text-red-700">
            {message}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">Neues Passwort</label>
        <input
          type="password"
          {...register('newPassword')}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        {errors.newPassword && <p className="text-xs text-red-700">{errors.newPassword.message}</p>}
      </div>

      <ul className="flex flex-col gap-0.5 text-xs text-neutral-500">
        <li className={lengthOk ? 'text-green-700' : undefined}>
          {lengthOk ? '✓' : '○'} Mindestens {PASSWORD_MIN_LENGTH} Zeichen
        </li>
        <li className={criteriaMet >= PASSWORD_MIN_CRITERIA ? 'text-green-700' : undefined}>
          {criteriaMet >= PASSWORD_MIN_CRITERIA ? '✓' : '○'} Mindestens {PASSWORD_MIN_CRITERIA} von 4:{' '}
          {PASSWORD_CRITERIA.map((c) => c.label).join(', ')}
        </li>
      </ul>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">Neues Passwort bestätigen</label>
        <input
          type="password"
          {...register('confirmPassword')}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        {errors.confirmPassword && <p className="text-xs text-red-700">{errors.confirmPassword.message}</p>}
      </div>

      {serverError && <p className="text-xs text-red-700">{serverError}</p>}
      {success && <p className="text-xs text-green-700">Passwort wurde geändert.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : 'Passwort ändern'}
      </button>
    </form>
  );
}
