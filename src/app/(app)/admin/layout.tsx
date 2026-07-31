import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

/**
 * Verwaltung-Brief.md: zentrales Admin-Gate statt der bisherigen identischen isSiteAdmin-Prüfung +
 * Fließtext-Fallback auf allen 4 /admin/*-Seiten. notFound() statt eines leeren Bildschirms mit
 * Fehlermeldung, wie im Brief gefordert - ein Nicht-Admin sieht eine echte 404-Seite.
 *
 * Schützt nur den Seiten-Render. Server Actions bleiben unverändert eigenständig durch
 * assertPermission(isSiteAdmin(...)) abgesichert (13 Stellen, siehe CLAUDE.md) - ein Layout kann
 * einen direkten Server-Action-Aufruf (z. B. aus den Browser-DevTools) nicht verhindern.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    notFound();
  }

  return (
    <div className="md:grid md:grid-cols-[210px_1fr] md:gap-6">
      <AdminSidebar />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
