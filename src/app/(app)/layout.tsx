import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { Nav } from '@/components/layout/nav';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
import { ProfileMenu } from '@/components/layout/profile-menu';
import { Footer } from '@/components/layout/footer';
import { MobileHeaderProvider } from '@/components/layout/mobile-header-context';
import { MobileHeaderTitleSlot } from '@/components/layout/mobile-header-title-slot';
import { MobileHeaderActionSlot } from '@/components/layout/mobile-header-action-slot';
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
    <MobileHeaderProvider>
      <div className="flex min-h-screen flex-col bg-[#f6f6f7]">
        {/* V2-Mobile: eine Zeile auf allen Breiten statt vormals flex-col (=> zwei gestapelte
            Zeilen unter sm:). Mobile-only Elemente (Wappen links, Crossfade-Titel, Filter-Slot,
            Initialen-Avatar) sind über sm:hidden ausgeblendet; Desktop-Elemente (Nav, Wortmarke,
            zweites Wappen rechts, Abmelden) über hidden sm:* wiederhergestellt - exakt der bisherige
            Desktop-Zustand, nur nicht mehr über flex-col/sm:flex-row erzwungen. */}
        <header className="pt-safe bg-[#1c1c1e] text-white">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-5 sm:h-auto sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-6">
              <img
                src="/wappen-afkdo.png"
                alt="Wappen AFKDO Purkersdorf"
                className="h-7 w-7 shrink-0 sm:hidden"
              />
              <MobileHeaderTitleSlot fallback="AFKDO Purkersdorf" />
              <span className="hidden text-sm font-semibold text-white sm:inline">AFKDO Purkersdorf</span>
              <Nav user={user} />
            </div>
            <div className="flex shrink-0 items-center gap-1 text-sm text-neutral-200 sm:gap-3">
              <MobileHeaderActionSlot />
              <img
                src="/wappen-afkdo.png"
                alt="Wappen AFKDO Purkersdorf"
                className="hidden h-10 w-auto sm:block"
              />
              <ProfileMenu
                name={user.name}
                email={user.email}
                homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
                isSiteAdmin={isSiteAdmin(user)}
                adminOrganizationNames={adminOrganizations.map((org) => org.shortName ?? org.name)}
                isDrohnengruppeMember={user.isDrohnengruppeMember}
                vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}
                logoutAction={logoutAction}
              />
              <form action={logoutAction} className="hidden sm:block">
                <button type="submit" className="rounded px-2 py-1 text-neutral-200 hover:bg-white/10">
                  Abmelden
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="pb-content-safe mx-auto w-full max-w-5xl flex-1 px-5 pt-6 sm:px-4 sm:pb-6">
          {children}
        </main>
        <div className="hidden sm:block">
          <Footer />
        </div>
        <MobileTabBar user={user} />
      </div>
    </MobileHeaderProvider>
  );
}
