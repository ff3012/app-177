import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { Nav } from '@/components/layout/nav';
import { ProfileMenu } from '@/components/layout/profile-menu';
import { Footer } from '@/components/layout/footer';
import { logoutAction } from './logout-action';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [homeOrganization, adminOrganizations] = await Promise.all([
    prisma.organization.findUnique({ where: { id: user.homeOrganizationId } }),
    user.feuerwehrAdminOrgIds.length > 0
      ? prisma.organization.findMany({ where: { id: { in: user.feuerwehrAdminOrgIds } } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <span className="text-sm font-semibold text-neutral-900">FF Abschnitt Purkersdorf</span>
            <Nav user={user} />
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <img src="/wappen-afkdo.png" alt="Wappen AFKDO Purkersdorf" className="h-8 w-auto sm:h-10" />
            <ProfileMenu
              name={user.name}
              email={user.email}
              homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
              isSiteAdmin={isSiteAdmin(user)}
              adminOrganizationNames={adminOrganizations.map((org) => org.shortName ?? org.name)}
              isDrohnengruppeMember={user.isDrohnengruppeMember}
            />
            <form action={logoutAction}>
              <button type="submit" className="rounded px-2 py-1 hover:bg-neutral-100">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <Footer />
    </div>
  );
}
