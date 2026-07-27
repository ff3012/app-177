import { SetPasswordForm } from '@/components/auth/set-password-form';
import { resetPassword } from './actions';

export default async function PasswortZuruecksetzenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const boundReset = resetPassword.bind(null, token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Neues Passwort setzen</h1>
        <p className="mb-6 text-sm text-neutral-500">Bitte lege dein neues Passwort fest.</p>
        <SetPasswordForm action={boundReset} submitLabel="Passwort speichern" />
      </div>
    </div>
  );
}
