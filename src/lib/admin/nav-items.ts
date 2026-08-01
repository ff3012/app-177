import type { SessionUser } from '@/types/next-auth';
import { canAccessHeimatfeuerwehrAdmin, isSiteAdmin } from '@/lib/auth/permissions';

export interface AdminNavItem {
  href: string;
  label: string;
}

/** Shared by AdminSidebarNav (Server-Component-Aufrufer AdminSidebar) und AdminMobileTabs (von
 * jeder /admin/*-Seite selbst aufgerufen) - analog zu getNavItems in lib/nav-items.ts. Die vier
 * ursprünglichen Verwaltung-Seiten bleiben Site-Admin-only; "Heimatfeuerwehr" ist zusätzlich für
 * reine Feuerwehr-Admins sichtbar (siehe canAccessHeimatfeuerwehrAdmin) - seit admin/layout.tsx's
 * Gate dafür aufgeweitet wurde, siehe CLAUDE.md "Sicherheits-Härtung". */
export function getAdminNavItems(user: SessionUser): AdminNavItem[] {
  const items: AdminNavItem[] = [];

  if (isSiteAdmin(user)) {
    items.push(
      { href: '/admin/benutzer', label: 'Benutzerverwaltung' },
      { href: '/admin/drohnen', label: 'Drohnengruppe' },
    );
  }

  if (canAccessHeimatfeuerwehrAdmin(user)) {
    items.push({ href: '/admin/heimatfeuerwehr', label: 'Heimatfeuerwehr' });
  }

  if (isSiteAdmin(user)) {
    items.push({ href: '/admin/email', label: 'E-Mail' }, { href: '/admin/status', label: 'Status' });
  }

  return items;
}
