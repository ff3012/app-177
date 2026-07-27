import { requireUser } from '@/lib/auth/session';
import { Nav } from '@/components/layout/nav';
import { logoutAction } from './logout-action';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <span className="text-sm font-semibold text-neutral-900">FF Abschnitt Purkersdorf</span>
            <Nav user={user} />
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <span>{user.name}</span>
            <form action={logoutAction}>
              <button type="submit" className="rounded px-2 py-1 hover:bg-neutral-100">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
