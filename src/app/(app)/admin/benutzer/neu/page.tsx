import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { UserForm } from '@/components/admin/user-form';
import { createUser } from '../actions';

export default async function NeuerBenutzerPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const organizations = await prisma.organization.findMany({ orderBy: { name: 'asc' } });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neuer Benutzer</h1>
      <UserForm organizations={organizations} action={createUser} submitLabel="Benutzer anlegen" passwordRequired />
    </div>
  );
}
