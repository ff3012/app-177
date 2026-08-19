import type { SessionUser } from '@/types/next-auth';
import { canAccessHeimatfeuerwehrAdmin, canViewDroneModule, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
}

/** Used by the desktop <Nav> (MobileTabBar has its own fixed 3-tab layout since the V3 mobile-nav
 * rework and no longer reads this list - see its own file comment). "News" is unconditional, not
 * gated on canSendAnyNews: reading /news is open to every member since the News-Modul rework
 * (issue #17), the same as "Meine Feuerwehr" - only composing/managing posts stays admin-gated,
 * inside the News pages themselves. A member reported this exact gap (no way to find the module
 * from the desktop nav, even though the header bell already worked) after the module already
 * shipped read-access to everyone; the bell being reachable isn't a substitute for a nav entry. */
export function getNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { href: '/kalender', label: 'Kalender' },
    { href: '/meine-feuerwehr', label: 'Meine Feuerwehr' },
    { href: '/news', label: 'News' },
  ];

  if (canViewDroneModule(user)) {
    items.push({ href: '/drohnen', label: 'Drohnengruppe' });
  }

  const verwaltung = getVerwaltungNavItem(user);
  if (verwaltung) {
    items.push(verwaltung);
  }

  return items;
}

/**
 * Der "Verwaltung"-Eintrag samt Ziel - eine Funktion statt zweier Kopien, weil ihn außer getNavItems
 * auch die mobile Kopfzeilen-Pille in (app)/layout.tsx braucht (die zuvor dieselbe Bedingung und
 * dieselbe Ziel-Auflösung ein zweites Mal inline enthielt und damit von Änderungen hier abwich).
 *
 * Bugfix-Historie: ursprünglich nur `if (isSiteAdmin(user))` - ein reiner Feuerwehr-Admin sah den
 * Menüpunkt gar nicht, obwohl canAccessHeimatfeuerwehrAdmin(user) bereits true zurückgab (per
 * Live-Test bestätigt). Derselbe Fehler traf danach den neuen dritten Fall, den reinen
 * Drohnengruppen-Admin: admin/layout.tsx und lib/admin/nav-items.ts lassen ihn korrekt zu
 * /admin/drohnen durch, aber ohne den dritten Zweig hier gab es keinen Link dorthin - die Rolle war
 * nur über direkte URL-Eingabe erreichbar. Jede Rolle landet auf der obersten Verwaltungsseite, die
 * sie tatsächlich sehen darf.
 */
export function getVerwaltungNavItem(user: SessionUser): NavItem | null {
  if (isBezirksAdmin(user)) {
    return { href: '/admin/benutzer', label: 'Verwaltung' };
  }
  if (canAccessHeimatfeuerwehrAdmin(user)) {
    return { href: '/admin/heimatfeuerwehr', label: 'Verwaltung' };
  }
  if (isDroneGroupAdmin(user) || user.isBezirksDrohnenAdmin) {
    return { href: '/admin/drohnen', label: 'Verwaltung' };
  }
  return null;
}

/** Nested routes (e.g. /kalender/abschnitt under /kalender) would otherwise match more than one
 * item's prefix check; only the longest (most specific) match wins. */
export function getActiveNavHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
