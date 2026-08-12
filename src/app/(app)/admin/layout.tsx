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
 * Nochmals aufgeweitet (Task 9 Review-Fix): auch ein reiner Drohnengruppen-Admin
 * (droneGroupRole === 'ADMIN', ohne jedes andere Admin-Recht) muss durchkommen, sonst würde ihn
 * dieses Layout schon abfangen, bevor /admin/drohnen's eigene, genauere Prüfung
 * (canManageDroneGroupFor gegen die konkrete DroneGroup) überhaupt zum Zug kommt - obwohl
 * getAdminNavItems diesem Benutzer den "Drohnengruppe"-Link längst zeigt. Bewusst nur das grobe
 * `droneGroupRole === 'ADMIN'`-Flag geprüft (kein DB-Zugriff auf Layout-Ebene nötig, das Layout
 * kennt keine konkrete Gruppen-Id) - leckt dadurch NICHTS an /admin/benutzer oder
 * /admin/heimatfeuerwehr, da beide Seiten weiterhin ihre eigene, strengere Prüfung haben, die ein
 * reiner Drohnengruppen-Admin nach wie vor nicht besteht. Identische Behandlung erhält
 * isBezirksDrohnenAdmin - ein Bezirks-Drohnenadmin ohne andere Admin-Rechte bekommt denselben
 * transparenten Durchgang zu /admin/drohnen.
 *
 * Schützt nur den Seiten-Render. Server Actions bleiben unverändert eigenständig durch
 * assertPermission(...) abgesichert (siehe CLAUDE.md) - ein Layout kann einen direkten
 * Server-Action-Aufruf (z. B. aus den Browser-DevTools) nicht verhindern.
 *
 * Benutzerverwaltung-Breite-Brief.md §1: flex statt grid, Inhalt flex-1 min-w-0 statt eines
 * zusätzlichen zentrierten Wrappers - min-w-0 ist nicht optional, ohne es weigert sich das
 * Flex-Kind zu schrumpfen und eine breite Tabelle erzeugt wieder einen Querscrollbalken. Das
 * ab md: ergänzte px-7 py-6 (28/24px) übernimmt genau das Innenabstand-Padding, das MainContainer
 * (components/layout/main-container.tsx) für /admin ab md: bewusst nicht mehr liefert - unterhalb
 * von md: liefert weiterhin <main> selbst das Padding, hier bleibt es unverändert bei 0.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!canAccessHeimatfeuerwehrAdmin(user) && user.droneGroupRole !== 'ADMIN' && !user.isBezirksDrohnenAdmin) {
    notFound();
  }

  return (
    <div className="flex md:items-stretch">
      <AdminSidebar user={user} />
      <div className="min-w-0 flex-1 md:px-7 md:py-6">{children}</div>
    </div>
  );
}
