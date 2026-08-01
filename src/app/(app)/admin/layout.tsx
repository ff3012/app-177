import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canAccessHeimatfeuerwehrAdmin } from '@/lib/auth/permissions';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

/**
 * Verwaltung-Brief.md: zentrales Admin-Gate statt der bisherigen identischen isSiteAdmin-Prüfung +
 * Fließtext-Fallback auf allen 4 /admin/*-Seiten. notFound() statt eines leeren Bildschirms mit
 * Fehlermeldung, wie im Brief gefordert - ein Nicht-Admin sieht eine echte 404-Seite.
 *
 * Gate aufgeweitet (isSiteAdmin ODER canAccessHeimatfeuerwehrAdmin), seit /admin/heimatfeuerwehr
 * auch für reine Feuerwehr-Admins ohne Abschnittskommando-Admin-Recht erreichbar sein muss. Als
 * Gegenmaßnahme haben die vier ursprünglichen Seiten (benutzer/drohnen/email/status) jetzt JEWEILS
 * eine eigene explizite isSiteAdmin-Prüfung statt sich allein auf dieses Layout zu verlassen -
 * siehe CLAUDE.md "Sicherheits-Härtung" im Heimatfeuerwehr-Abschnitt.
 *
 * Schützt nur den Seiten-Render. Server Actions bleiben unverändert eigenständig durch
 * assertPermission(...) abgesichert (siehe CLAUDE.md) - ein Layout kann einen direkten
 * Server-Action-Aufruf (z. B. aus den Browser-DevTools) nicht verhindern.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!canAccessHeimatfeuerwehrAdmin(user)) {
    notFound();
  }

  return (
    <div className="md:grid md:grid-cols-[210px_1fr] md:gap-6">
      <AdminSidebar user={user} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
