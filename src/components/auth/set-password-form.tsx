'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  setPasswordSchema,
  type SetPasswordInput,
  type SetPasswordState,
} from '@/lib/validation/set-password.schema';
import {
  countPasswordCriteria,
  PASSWORD_CRITERIA,
  PASSWORD_MIN_CRITERIA,
  PASSWORD_MIN_LENGTH,
} from '@/lib/validation/password-policy';

interface SetPasswordFormProps {
  action: (prevState: SetPasswordState, formData: FormData) => Promise<SetPasswordState>;
  submitLabel: string;
}

export function SetPasswordForm({ action, submitLabel }: SetPasswordFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';
  const criteriaMet = countPasswordCriteria(newPassword);
  const lengthOk = newPassword.length >= PASSWORD_MIN_LENGTH;

  function onSubmit(values: SetPasswordInput) {
    const formData = new FormData();
    formData.set('newPassword', values.newPassword);
    formData.set('confirmPassword', values.confirmPassword);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Neues Passwort</label>
        <input
          type="password"
          {...register('newPassword')}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {errors.newPassword && <p className="text-sm text-red-700">{errors.newPassword.message}</p>}
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
        <label className="text-sm font-medium text-neutral-700">Neues Passwort bestätigen</label>
        <input
          type="password"
          {...register('confirmPassword')}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {errors.confirmPassword && <p className="text-sm text-red-700">{errors.confirmPassword.message}</p>}
      </div>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Speichern…' : submitLabel}
      </button>
    </form>
  );
}
