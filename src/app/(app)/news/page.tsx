import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageNews } from '@/lib/auth/permissions';
import type { NewsMessage, Organization, User } from '@prisma/client';

const EMPTY_MESSAGE = 'Noch keine News erstellt.';

type NewsMessageWithRelations = NewsMessage & { audienceOrg: Organization | null; createdBy: User };

function getAudienceLabel(message: NewsMessageWithRelations): string {
  return message.audienceType === 'DROHNENGRUPPE'
    ? 'Drohnengruppe'
    : (message.audienceOrg?.shortName ?? message.audienceOrg?.name ?? '–');
}

function getStatusLabel(message: NewsMessageWithRelations): string {
  return message.sentAt
    ? `Gesendet am ${message.sentAt.toLocaleString('de-AT')}`
    : message.scheduledAt
      ? `Geplant für ${message.scheduledAt.toLocaleString('de-AT')}`
      : 'Ausstehend';
}

/** Reine Lese-Karte für schmale Bildschirme - anders als bei Drohnenflügen/Benutzern gibt es keine
 * Detail-/Bearbeiten-Route für einzelne News-Nachrichten, daher kein <Link>-Wrapper. */
function NewsMessageCard({ message }: { message: NewsMessageWithRelations }) {
  return (
    <div className="flex flex-col gap-1 border-b border-neutral-100 px-4 py-3 last:border-0">
      <span className="font-medium text-neutral-900">{message.title}</span>
      <span className="text-sm text-neutral-500">{getAudienceLabel(message)}</span>
      <span className={`text-sm ${message.sentAt ? 'text-green-700' : 'text-neutral-600'}`}>
        {getStatusLabel(message)}
      </span>
      <span className="text-xs text-neutral-400">
        Erstellt von {message.createdBy.firstName} {message.createdBy.lastName}
      </span>
    </div>
  );
}

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

      {messages.length === 0 ? (
        <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">{EMPTY_MESSAGE}</div>
      ) : (
        <>
          <div className="flex flex-col rounded-lg bg-white shadow-sm sm:hidden">
            {messages.map((message) => (
              <NewsMessageCard key={message.id} message={message} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm sm:block">
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
                {messages.map((message) => (
                  <tr key={message.id} className="border-b border-neutral-100">
                    <td className="px-4 py-2">{message.title}</td>
                    <td className="px-4 py-2">{getAudienceLabel(message)}</td>
                    <td className="px-4 py-2">
                      <span className={message.sentAt ? 'text-green-700' : 'text-neutral-600'}>
                        {getStatusLabel(message)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {message.createdBy.firstName} {message.createdBy.lastName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
