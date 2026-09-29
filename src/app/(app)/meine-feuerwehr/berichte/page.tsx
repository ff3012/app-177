import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';

/** "Alle" hinter /meine-feuerwehr's "Meine Berichte"-Vorschau (dort nur `take: 3`) - dieselbe
 * Sichtbarkeitsregel (eigene, bereits abgegebene Berichte: Ersteller ODER Ausfüller), nur ohne
 * Begrenzung. Kein Entwurf-Konzept mehr, jeder existierende Bericht ist bereits abgegeben. */
export default async function MeineBerichtePage() {
  const user = await requireUser();

  const reports = await prisma.report.findMany({
    where: { OR: [{ createdById: user.id }, { filledById: user.id }] },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, type: true, number: true, year: true, startAt: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Meine Berichte</h1>
        <Link href="/meine-feuerwehr" className="text-sm text-brand hover:underline">
          Zurück
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {reports.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">Noch keine Berichte abgegeben.</p>
        ) : (
          reports.map((report, index) => (
            <Link
              key={report.id}
              href={`/meine-feuerwehr/berichte/${report.id}/abgeschlossen`}
              className={`flex items-center justify-between gap-3 px-4 py-3 ${index === reports.length - 1 ? '' : 'border-b border-[#f0f0f2]'}`}
            >
              <span className="text-[14px] text-[#1c1c1e]">
                {REPORT_TYPE_LABEL[report.type]} Nr. {report.number}/{report.year} · {report.startAt.toLocaleDateString('de-AT')}
              </span>
              <span className="flex-none rounded-full bg-[#eaf6f0] px-2.5 py-1 text-[12px] font-semibold text-[#1b7a52]">
                Abgegeben
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
