import { redirect } from 'next/navigation';
import { getOptionalUser } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const user = await getOptionalUser();
  if (user) {
    redirect('/kalender');
  }

  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-100 px-4 sm:flex-row sm:gap-10">
      <img src="/wappen-afkdo.png" alt="Wappen AFKDO Purkersdorf" className="w-40 shrink-0 sm:w-52" />
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Feuerwehr Abschnitt Purkersdorf</h1>
        <p className="mb-6 text-sm text-neutral-500">Anmeldung für Mitglieder</p>
        <LoginForm callbackUrl={callbackUrl ?? '/kalender'} />
      </div>
    </div>
  );
}
