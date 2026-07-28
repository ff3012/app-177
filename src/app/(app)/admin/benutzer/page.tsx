import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { MembershipRole } from '@prisma/client';
import { AdminNav } from '@/components/layout/admin-nav';

export default async function BenutzerverwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const users = await prisma.user.findMany({
    include: {
      homeOrganization: true,
      memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
      droneMembership: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-3 text-lg font-semibold text-neutral-900">Verwaltung</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AdminNav />
          <Link
            href="/admin/benutzer/neu"
            className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark"
          >
            Neuer Benutzer
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">E-Mail</th>
              <th className="px-4 py-2">Heimat-Feuerwehr</th>
              <th className="px-4 py-2">Admin für</th>
              <th className="px-4 py-2">Drohnengruppe</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-neutral-100">
                <td className="px-4 py-2">
                  {u.firstName} {u.lastName}
                </td>
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.homeOrganization.shortName ?? u.homeOrganization.name}</td>
                <td className="px-4 py-2">
                  {u.memberships.map((m) => m.organization.shortName ?? m.organization.name).join(', ') || '–'}
                </td>
                <td className="px-4 py-2">
                  {u.droneMembership?.role === 'ADMIN' ? 'Admin' : u.droneMembership ? 'Mitglied' : '–'}
                </td>
                <td className="px-4 py-2">{u.isActive ? 'Aktiv' : 'Deaktiviert'}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/benutzer/${u.id}`} className="text-brand hover:underline">
                    Bearbeiten
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
