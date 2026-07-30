import type { SessionUser } from '@/types/next-auth';
import { canManageNews, canViewDroneModule, isSiteAdmin } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
}

/** Shared by the desktop <Nav> and the mobile <MobileTabBar> so the permission-filtered item list
 * (and its 1-4 item count) can never drift between the two. */
export function getNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [{ href: '/kalender', label: 'Kalender' }];

  if (canViewDroneModule(user)) {
    items.push({ href: '/drohnen', label: 'Drohnengruppe' });
  }

  if (canManageNews(user)) {
    items.push({ href: '/news', label: 'News' });
  }

  if (isSiteAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Verwaltung' });
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
