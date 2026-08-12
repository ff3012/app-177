import type { SessionUser } from '@/types/next-auth';
import {
  canAccessBezirksverwaltung,
  canAccessHeimatfeuerwehrAdmin,
  canAccessUserManagementAdmin,
  isBezirksAdmin,
} from '@/lib/auth/permissions';

export interface AdminNavItem {
  href: string;
  label: string;
}

/** Shared by AdminSidebarNav (Server-Component-Aufrufer AdminSidebar) und AdminMobileTabs (von
 * jeder /admin/*-Seite selbst aufgerufen) - analog zu getNavItems in lib/nav-items.ts.
 * "Benutzerverwaltung" und "Heimatfeuerwehr" sind zusätzlich für reine Feuerwehr-Admins sichtbar
 * (siehe canAccessUserManagementAdmin/canAccessHeimatfeuerwehrAdmin, jeweils auf ihre eigene(n)
 * Feuerwehr(en) skaliert) - Drohnengruppe/E-Mail/Status/Bezirksverwaltung bleiben Site-Admin- bzw.
 * bezirksweiten Rollen vorbehalten, siehe CLAUDE.md "Sicherheits-Härtung". */
export function getAdminNavItems(user: SessionUser): AdminNavItem[] {
  const items: AdminNavItem[] = [];

  if (canAccessUserManagementAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Benutzerverwaltung' });
  }

  if (
    isBezirksAdmin(user) ||
    user.isBezirksDrohnenAdmin ||
    user.abschnittAdminOrgIds.length > 0 ||
    user.droneGroupRole === 'ADMIN'
  ) {
    items.push({ href: '/admin/drohnen', label: 'Drohnengruppe' });
  }

  if (canAccessHeimatfeuerwehrAdmin(user)) {
    items.push({ href: '/admin/heimatfeuerwehr', label: 'Heimatfeuerwehr' });
  }

  if (canAccessBezirksverwaltung(user)) {
    items.push({ href: '/admin/bezirksverwaltung', label: 'Bezirksverwaltung' });
  }

  if (isBezirksAdmin(user)) {
    items.push({ href: '/admin/email', label: 'E-Mail' }, { href: '/admin/status', label: 'Status' });
  }

  return items;
}
