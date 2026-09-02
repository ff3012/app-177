import { requireUser } from '@/lib/auth/session';
import { canAccessUserManagementAdmin } from '@/lib/auth/permissions';
import { ImportUsersForm } from './import-form';

export default async function BenutzerImportPage() {
  const user = await requireUser();
  if (!canAccessUserManagementAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Benutzerverwaltung sichtbar.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Benutzer importieren</h1>
      <ImportUsersForm />
    </div>
  );
}
