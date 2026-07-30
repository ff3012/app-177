import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { Nav } from '@/components/layout/nav';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
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
    <div className="flex min-h-screen flex-col bg-[#f6f6f7]">
      <header className="pt-safe bg-[#1c1c1e] text-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <span className="text-sm font-semibold text-white">AFKDO Purkersdorf</span>
            <Nav user={user} />
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-200">
            <img src="/wappen-afkdo.png" alt="Wappen AFKDO Purkersdorf" className="h-8 w-auto sm:h-10" />
            <ProfileMenu
              name={user.name}
              email={user.email}
              homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
              isSiteAdmin={isSiteAdmin(user)}
              adminOrganizationNames={adminOrganizations.map((org) => org.shortName ?? org.name)}
              isDrohnengruppeMember={user.isDrohnengruppeMember}
              vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}
            />
            <form action={logoutAction}>
              <button type="submit" className="rounded px-2 py-1 text-neutral-200 hover:bg-white/10">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="pb-content-safe mx-auto w-full max-w-5xl flex-1 px-4 pt-6 sm:pb-6">{children}</main>
      <div className="hidden sm:block">
        <Footer />
      </div>
      <MobileTabBar user={user} />
    </div>
  );
}
