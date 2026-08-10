import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewDroneModule } from '@/lib/auth/permissions';

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DrohnenUnterlagenPage() {
  const user = await requireUser();
  if (!canViewDroneModule(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für Mitglieder der Drohnengruppe sichtbar.</p>;
  }

  // Scoped auf die eigene Drohnengruppe - vor Task 9 gab es systemweit nur eine einzige Gruppe,
  // daher fiel eine fehlende droneGroupId-Filterung hier bislang nicht als Leck auf.
  const documents = await prisma.droneDocument.findMany({
    where: { droneGroupId: user.droneGroupId! },
    select: { id: true, title: true, filename: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Unterlagen</h1>
        <Link href="/drohnen" className="text-sm text-brand hover:underline">
          Zurück zum Flugbuch
        </Link>
      </div>

      <div className="rounded-lg bg-white shadow-sm">
        {documents.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">Noch keine Unterlagen vorhanden.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-neutral-900">{doc.title}</p>
                  <p className="text-xs text-neutral-500">
                    {formatBytes(doc.sizeBytes)} · {doc.createdAt.toLocaleDateString('de-AT')}
                  </p>
                </div>
                <a
                  href={`/drohnen/unterlagen/${doc.id}`}
                  className="shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  Herunterladen
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
