import { prisma } from '@/lib/db/prisma';
import { getDroneQuickRegisterToken } from '@/lib/settings';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { AddDroneForm } from './add-drone-form';
import { RenameDroneForm } from './rename-drone-form';
import { UploadDocumentForm } from './upload-document-form';
import { toggleDroneActive, regenerateQuickRegisterLink, deleteDroneDocument } from './actions';

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

// Admin-Gate läuft jetzt in admin/layout.tsx per notFound() - siehe Kommentar dort.
export default async function DrohnenVerwaltungPage() {
  const [drones, quickRegisterToken, documents] = await Promise.all([
    prisma.drone.findMany({ orderBy: { sortOrder: 'asc' } }),
    getDroneQuickRegisterToken(),
    prisma.droneDocument.findMany({
      select: {
        id: true,
        title: true,
        filename: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const quickRegisterLink = quickRegisterToken ? `${baseUrl()}/drohnen-schnell/${quickRegisterToken}` : null;

  return (
    <div className="flex flex-col gap-6">

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {drones.map((drone) => {
              const boundToggle = toggleDroneActive.bind(null, drone.id);
              return (
                <tr key={drone.id} className="border-b border-neutral-100">
                  <td className="px-4 py-2">
                    <RenameDroneForm droneId={drone.id} currentName={drone.name} />
                  </td>
                  <td className="px-4 py-2">{drone.isActive ? 'Aktiv' : 'Deaktiviert'}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={boundToggle}>
                      <button type="submit" className="text-brand hover:underline">
                        {drone.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddDroneForm />

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">QR-Code Schnellerfassung</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Dieser Link führt ohne Anmeldung direkt zum Formular „Flug registrieren“ – gedacht, um ihn als QR-Code
          auszudrucken. Wer den Link/QR-Code kennt, kann damit ausschließlich neue Flüge anlegen; andere Daten
          (bestehende Flüge, Benutzer, …) sind darüber nicht einsehbar. Ein neu erzeugter Link macht den alten QR-Code
          sofort ungültig.
        </p>

        {quickRegisterLink && (
          <div className="mb-3 flex items-start gap-2">
            <p className="flex-1 break-all rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
              {quickRegisterLink}
            </p>
            <CopyLinkButton text={quickRegisterLink} />
          </div>
        )}

        <form action={regenerateQuickRegisterLink}>
          <button
            type="submit"
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
          >
            {quickRegisterLink ? 'Link neu erzeugen' : 'Link erzeugen'}
          </button>
        </form>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">Unterlagen für Mitglieder</h2>
        <p className="mb-3 text-sm text-neutral-500">
          PDFs, die für alle Mitglieder der Drohnengruppe unter „Unterlagen“ zum Download bereitstehen.
        </p>

        <UploadDocumentForm />

        {documents.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-neutral-100 border-t border-neutral-100">
            {documents.map((doc) => {
              const boundDelete = deleteDroneDocument.bind(null, doc.id);
              return (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-neutral-900">{doc.title}</p>
                    <p className="text-xs text-neutral-500">
                      {doc.filename} · {formatBytes(doc.sizeBytes)} · {doc.uploadedBy.firstName} {doc.uploadedBy.lastName} ·{' '}
                      {doc.createdAt.toLocaleDateString('de-AT')}
                    </p>
                  </div>
                  <form action={boundDelete}>
                    <button type="submit" className="shrink-0 text-red-700 hover:underline">
                      Löschen
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
