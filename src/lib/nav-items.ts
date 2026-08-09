import type { SessionUser } from '@/types/next-auth';
import { canAccessHeimatfeuerwehrAdmin, canManageNews, canViewDroneModule, isBezirksAdmin } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
}

/** Shared by the desktop <Nav> and the mobile <MobileTabBar> so the permission-filtered item list
 * (up to 5 items now that "Meine Feuerwehr" is unconditional like Kalender) can never drift
 * between the two - MobileTabBar's --tab-count grid is dynamic, not hardcoded to 4. */
export function getNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { href: '/kalender', label: 'Kalender' },
    { href: '/meine-feuerwehr', label: 'Meine Feuerwehr' },
  ];

  if (canViewDroneModule(user)) {
    items.push({ href: '/drohnen', label: 'Drohnengruppe' });
  }

  if (canManageNews(user)) {
    items.push({ href: '/news', label: 'News' });
  }

  // Bugfix: vorher nur `if (isSiteAdmin(user))` - ein reiner Feuerwehr-Admin (Membership-Admin
  // ohne Abschnittskommando-Admin) sah dadurch den Menüpunkt "Verwaltung" gar nicht und konnte
  // /admin/heimatfeuerwehr praktisch nicht erreichen, obwohl canAccessHeimatfeuerwehrAdmin(user)
  // bereits korrekt true zurückgab (per Live-Test mit einem echten Konto bestätigt). Site-Admins
  // landen weiterhin auf der Benutzerverwaltung, reine Feuerwehr-Admins direkt auf der einzigen
  // Verwaltungsseite, die sie tatsächlich sehen dürfen.
  if (isBezirksAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Verwaltung' });
  } else if (canAccessHeimatfeuerwehrAdmin(user)) {
    items.push({ href: '/admin/heimatfeuerwehr', label: 'Verwaltung' });
  }

  return items;
}

/** Nested routes (e.g. /kalender/abschnitt under /kalender) would otherwise match more than one
 * item's prefix check; only the longest (most specific) match wins. */
export function getActiveNavHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
