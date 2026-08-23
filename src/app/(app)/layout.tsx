import { Toaster } from 'sonner';
import Link from 'next/link';
import { TooltipProvider } from '@/components/ui/tooltip';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canSendAnyNews, isBezirksAdmin } from '@/lib/auth/permissions';
import { getVerwaltungNavItem } from '@/lib/nav-items';
import { getUnreadNewsCount } from '@/lib/news/audience';
import { Nav } from '@/components/layout/nav';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
import { ProfileMenu } from '@/components/layout/profile-menu';
import { Footer } from '@/components/layout/footer';
import { MobileHeaderProvider } from '@/components/layout/mobile-header-context';
import { MobileHeaderTitleSlot } from '@/components/layout/mobile-header-title-slot';
import { MobileHeaderActionSlot } from '@/components/layout/mobile-header-action-slot';
import { MainContainer } from '@/components/layout/main-container';
import { AndroidBackButton } from '@/components/capacitor/android-back-button';
import { logoutAction } from './logout-action';

/** Startbildschirm-Brief.md §2: "Feuerwehr {Heimatfeuerwehr}", ohne "Freiwillige" - für
 * AFKDO-Mitglieder (kein "Feuerwehr X"-Kontext) einfach der Org-Name selbst. */
function buildMobileHeaderLabel(org: { name: string; shortName: string | null; type: string }): string {
  if (org.type === 'ABSCHNITTSKOMMANDO') return org.shortName ?? org.name;
  return `Feuerwehr ${org.shortName ?? org.name}`;
}

// Gesetzt nur in docker-compose.staging.yml (APP_STAGE: dev) - in Prod nie gesetzt, daher dort
// immer false. Rein visuell: unterscheidet den dunklen Header von app-177 vom orangen Header von
// dev.app-177, damit auf einen Blick klar ist, in welcher Umgebung man sich befindet.
const isDevStage = process.env.APP_STAGE === 'dev';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [homeOrganization, adminOrganizations, unreadNewsCount] = await Promise.all([
    // Explizites select statt findUnique ohne select: wappenImageData ist ein potenziell
    // mehrere hundert KB großer Bytes-Blob, der bei jeder Navigation sonst unnötig mitgeladen
    // würde, obwohl hier nur wappenImageMimeType (Präsenz-Check) gebraucht wird.
    prisma.organization.findUnique({
      where: { id: user.homeOrganizationId },
      select: { id: true, name: true, shortName: true, type: true, wappenImageMimeType: true },
    }),
    user.feuerwehrAdminOrgIds.length > 0
      ? prisma.organization.findMany({ where: { id: { in: user.feuerwehrAdminOrgIds } } })
      : Promise.resolve([]),
    getUnreadNewsCount(user.id),
  ]);

  const mobileHeaderLabel = homeOrganization ? buildMobileHeaderLabel(homeOrganization) : 'BFKDO St. Pölten';
  const wappenSrc = homeOrganization?.wappenImageMimeType ? `/api/organization/${homeOrganization.id}/wappen` : null;
  // Dieselbe Quelle wie der Desktop-Nav-Eintrag (lib/nav-items.ts) statt einer zweiten, hier inline
  // gepflegten Kopie derselben Bedingung/Ziel-Auflösung - sonst fehlt der mobilen Pille jeder künftig
  // dort ergänzte Fall (zuletzt: der reine Drohnengruppen-Admin, der auf /admin/drohnen gehört).
  const verwaltungNavItem = getVerwaltungNavItem(user);
  const showVerwaltungPill = verwaltungNavItem !== null;
  const verwaltungHref = verwaltungNavItem?.href ?? '/admin/heimatfeuerwehr';

  return (
    <TooltipProvider>
    <MobileHeaderProvider>
      <div className="flex min-h-screen flex-col bg-[#f6f6f7]">
        <AndroidBackButton />
        {/* V2-Mobile: eine Zeile auf allen Breiten statt vormals flex-col (=> zwei gestapelte
            Zeilen unter sm:). Mobile-only Elemente (Wappen links, Crossfade-Titel, Filter-Slot,
            Initialen-Avatar) sind über sm:hidden ausgeblendet; Desktop-Elemente (Nav, Wortmarke,
            zweites Wappen rechts, Abmelden) über hidden sm:* wiederhergestellt - exakt der bisherige
            Desktop-Zustand, nur nicht mehr über flex-col/sm:flex-row erzwungen. */}
        <header className={`pt-safe text-white ${isDevStage ? 'bg-[#c2410c]' : 'bg-[#1c1c1e]'}`}>
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-5 sm:h-auto sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-6">
              {/* Startbildschirm-Brief.md §2: Wappen sitzt nur noch in der Tab-Bar (Wappen-Home-Tab),
                  nicht mehr zusätzlich links in der Kopfzeile - das Mobile-Wappen-<img> von V2/V3
                  entfällt deshalb hier ersatzlos. */}
              <MobileHeaderTitleSlot fallback={mobileHeaderLabel} />
              <span className="hidden text-sm font-semibold text-white sm:inline">BFKDO St. Pölten</span>
              {isDevStage && (
                <span className="shrink-0 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                  <span className="sm:hidden">DEV</span>
                  <span className="hidden sm:inline">DEVELOPMENT</span>
                </span>
              )}
              <Nav user={user} />
            </div>
            <div className="flex shrink-0 items-center gap-1 text-sm text-neutral-200 sm:gap-3">
              <MobileHeaderActionSlot />
              {showVerwaltungPill && (
                <Link
                  href={verwaltungHref}
                  className="inline-flex h-[30px] items-center rounded-full border border-[#4a4a4e] px-3 text-[13px] font-semibold text-white sm:hidden"
                >
                  Verwaltung
                </Link>
              )}
              <img
                src="/wappen-bfkdo.png"
                alt="Wappen BFKDO St. Pölten"
                className="hidden h-10 w-auto sm:block"
              />
              <ProfileMenu
                name={user.name}
                email={user.email}
                homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
                isSiteAdmin={isBezirksAdmin(user)}
                adminOrganizationNames={adminOrganizations.map((org) => org.shortName ?? org.name)}
                isDrohnengruppeMember={user.isDrohnengruppeMember}
                canSendAnyNews={canSendAnyNews(user)}
                unreadNewsCount={unreadNewsCount}
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
        <MainContainer>{children}</MainContainer>
        <div className="hidden sm:block">
          <Footer />
        </div>
        <MobileTabBar user={user} wappenSrc={wappenSrc} />
        {/* App ist fixed-light-themed (siehe globals.css/color-scheme:light) - theme="light" statt
            sonners Standard "system", damit Toasts bei OS-Dark-Mode nicht plötzlich abweichen. */}
        <Toaster theme="light" position="top-right" richColors />
      </div>
    </MobileHeaderProvider>
    </TooltipProvider>
  );
}
