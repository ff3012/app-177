import { SetPasswordForm } from '@/components/auth/set-password-form';
import { activateAccount } from './actions';

export default async function AktivierenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const boundActivate = activateAccount.bind(null, token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Konto aktivieren</h1>
        <p className="mb-6 text-sm text-neutral-500">Lege dein Passwort fest, um dein Konto zu aktivieren.</p>
        <SetPasswordForm action={boundActivate} submitLabel="Konto aktivieren" />
      </div>
    </div>
  );
}
