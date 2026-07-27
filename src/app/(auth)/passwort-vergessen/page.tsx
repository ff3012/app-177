import Link from 'next/link';
import { ForgotPasswordForm } from './request-form';

export default function PasswortVergessenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Passwort vergessen</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Gib deine E-Mail-Adresse ein, wir senden dir einen Link zum Zurücksetzen.
        </p>
        <ForgotPasswordForm />
        <Link href="/login" className="mt-4 inline-block text-sm text-neutral-600 hover:underline">
          Zurück zum Login
        </Link>
      </div>
    </div>
  );
}
