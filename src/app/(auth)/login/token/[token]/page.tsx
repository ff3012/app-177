import { ConfirmLoginForm } from './confirm-login-form';
import { confirmEmailTokenLogin } from './actions';

export default async function EmailTokenLoginPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const boundConfirm = confirmEmailTokenLogin.bind(null, token);

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Anmeldung per E-Mail-Link</h1>
        <p className="mb-6 text-sm text-neutral-500">Klicke auf "Jetzt anmelden", um dich mit diesem Link anzumelden.</p>
        <ConfirmLoginForm action={boundConfirm} />
      </div>
    </div>
  );
}
