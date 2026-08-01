import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { ImportVehiclesForm } from './import-form';

export default async function FuhrparkImportPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const user = await requireUser();
  const { org } = await searchParams;

  if (!org || !canManageHeimatfeuerwehrFor(user, org)) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Fuhrpark importieren</h1>
      <ImportVehiclesForm organizationId={org} />
    </div>
  );
}
