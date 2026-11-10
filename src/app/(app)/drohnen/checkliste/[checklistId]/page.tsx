import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { getChecklistView } from '@/lib/drone/checklist/queries';
import { ChecklistWizard } from '@/components/drone/checklist/checklist-wizard';

export default async function ChecklistePage({
  params,
  searchParams,
}: {
  params: Promise<{ checklistId: string }>;
  searchParams: Promise<{ schritt?: string }>;
}) {
  const user = await requireUser();
  const { checklistId } = await params;
  const { schritt } = await searchParams;

  const view = await getChecklistView(user, checklistId);
  if (!view) notFound();
  if (view.checklist.status === 'SUBMITTED') redirect(`/drohnen/checkliste/${checklistId}/fertig`);
  if (view.checklist.status === 'DISCARDED') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[22px] font-bold text-ink">Entwurf verworfen</h1>
        <p className="text-ink-muted">Dieser Entwurf wurde verworfen und kann nicht mehr bearbeitet werden. Er bleibt in der Drohnenverwaltung sichtbar.</p>
        <Link href="/drohnen" className="text-brand hover:underline">
          Zurück zum Flugbuch
        </Link>
      </div>
    );
  }

  const [members, drones] = await Promise.all([
    listDrohnengruppeMembers(view.droneGroup.id),
    prisma.drone.findMany({ where: { droneGroupId: view.droneGroup.id }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, isActive: true } }),
  ]);

  const requestedStep = Number.parseInt(schritt ?? '', 10);
  const initialStep = Number.isInteger(requestedStep) ? requestedStep : view.checklist.step;

  return (
    <ChecklistWizard
      checklistId={checklistId}
      initialData={view.checklist.data}
      initialStep={initialStep}
      members={members.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }))}
      drones={drones}
      userId={user.id}
      canConfirmAny={view.canConfirmAny}
      readOnly={!view.canEdit}
    />
  );
}
