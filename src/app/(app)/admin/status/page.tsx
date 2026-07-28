import { requireUser } from '@/lib/auth/session';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { AdminNav } from '@/components/layout/admin-nav';
import { SystemCheckPanel } from './system-check-panel';

export default async function StatusPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-3 text-lg font-semibold text-neutral-900">Verwaltung</h1>
        <AdminNav />
      </div>

      <SystemCheckPanel />
    </div>
  );
}
