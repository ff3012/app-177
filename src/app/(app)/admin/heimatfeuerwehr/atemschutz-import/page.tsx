import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { getOrganizationFeatures } from '@/lib/heimatfeuerwehr/features';
import { ImportAtemschutzForm } from './import-form';

export default async function AtemschutzImportPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const user = await requireUser();
  const { org } = await searchParams;

  if (!org || !canManageHeimatfeuerwehrFor(user, org)) {
    notFound();
  }

  const { atemschutz } = await getOrganizationFeatures(org);
  if (!atemschutz) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Atemschutz-Untersuchungen importieren</h1>
      <ImportAtemschutzForm organizationId={org} />
    </div>
  );
}
