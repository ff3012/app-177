import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canImportDroneAusbildung } from '@/lib/auth/permissions';
import { ImportAusbildungForm } from './import-form';

export default async function AusbildungImportPage() {
  const user = await requireUser();
  if (!canImportDroneAusbildung(user)) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Ausbildungsstufen importieren</h1>
      <ImportAusbildungForm />
    </div>
  );
}
