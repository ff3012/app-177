import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { RegistrationForm } from './registration-form';

// Öffentliche Route ohne requireUser()/auth()-Aufruf, der Next sonst automatisch zur dynamischen
// Verarbeitung zwingen würde (wie bei jeder (app)-Seite) - ohne dieses Flag hätte Next die
// Feuerwehr-/Dienstgrad-Listen beim Production-Build einmalig statisch eingefroren (bestätigt: ohne
// dieses Flag wird die Seite als "○ Static" gebaut), sodass neu angelegte oder deaktivierte
// Feuerwehren erst nach dem nächsten Deploy sichtbar würden. Gleiches Muster wie
// src/app/dashboard/[token]/page.tsx, der anderen öffentlichen, live aus der DB lesenden Route.
export const dynamic = 'force-dynamic';

export default async function RegistrierenPage() {
  const [organizations, dienstgrade] = await Promise.all([
    prisma.organization.findMany({
      where: { type: 'FEUERWEHR', isActive: true },
      orderBy: { name: 'asc' },
      include: { parent: { select: { shortName: true, name: true } } },
    }),
    prisma.dienstgrad.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  const organizationOptions = organizations.map((org) => ({
    id: org.id,
    name: org.shortName ?? org.name,
    abschnittName: org.parent?.shortName ?? org.parent?.name,
  }));

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Registrierung</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Melde dich hier als neues Mitglied deiner Feuerwehr an. Ein Admin prüft deine Angaben und
          schaltet dein Konto frei.
        </p>
        <RegistrationForm
          organizations={organizationOptions}
          dienstgrade={dienstgrade.map((d) => ({ id: d.id, kurzform: d.kurzform }))}
        />
        <Link href="/login" className="mt-4 inline-block text-sm text-neutral-600 hover:underline">
          Zurück zum Login
        </Link>
      </div>
    </div>
  );
}
