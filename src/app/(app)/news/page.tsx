import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageNews } from '@/lib/auth/permissions';

export default async function NewsPage() {
  const user = await requireUser();
  if (!canManageNews(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const messages = await prisma.newsMessage.findMany({
    include: { audienceOrg: true, createdBy: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">News</h1>
        <Link href="/news/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
          Neue News
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="px-4 py-2">Titel</th>
              <th className="px-4 py-2">Zielgruppe</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Erstellt von</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => {
              const audienceLabel =
                message.audienceType === 'DROHNENGRUPPE'
                  ? 'Drohnengruppe'
                  : (message.audienceOrg?.shortName ?? message.audienceOrg?.name ?? '–');
              const statusLabel = message.sentAt
                ? `Gesendet am ${message.sentAt.toLocaleString('de-AT')}`
                : message.scheduledAt
                  ? `Geplant für ${message.scheduledAt.toLocaleString('de-AT')}`
                  : 'Ausstehend';
              return (
                <tr key={message.id} className="border-b border-neutral-100">
                  <td className="px-4 py-2">{message.title}</td>
                  <td className="px-4 py-2">{audienceLabel}</td>
                  <td className="px-4 py-2">
                    <span className={message.sentAt ? 'text-green-700' : 'text-neutral-600'}>{statusLabel}</span>
                  </td>
                  <td className="px-4 py-2">
                    {message.createdBy.firstName} {message.createdBy.lastName}
                  </td>
                </tr>
              );
            })}
            {messages.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  Noch keine News erstellt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
