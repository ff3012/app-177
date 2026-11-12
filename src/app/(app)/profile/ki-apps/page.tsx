import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { listConnections } from '@/lib/mcp/connections';
import { getMcpAccessOf } from '@/lib/mcp/access-db';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { revokeMyConnection } from './actions';

const dateTime = (date: Date) =>
  date.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' });

export default async function KiAppsPage() {
  if (!(await isMcpEnabled())) notFound();
  const user = await requireUser();
  const [access, connections] = await Promise.all([getMcpAccessOf(user.id), listConnections(user.id)]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Verbundene KI-Apps</h1>
      <p className="max-w-[640px] text-[15px] text-ink-muted">
        Hier siehst du, welche KI-Anwendungen (z. B. Claude oder ChatGPT) in deinem Namen auf die Feuerwehr-App zugreifen dürfen.
        Sie sehen nur, was du auch in der App sehen darfst.
      </p>
      {access === 'NONE' && (
        <p className="max-w-[640px] rounded-lg bg-surface p-4 text-sm text-ink shadow-card">
          Dein Konto hat derzeit keinen KI-Zugriff. Bestehende Verbindungen funktionieren nicht mehr.
        </p>
      )}
      {connections.length === 0 ? (
        <p className="max-w-[640px] rounded-lg bg-surface p-4 text-sm text-ink-muted shadow-card">Keine aktiven Verbindungen.</p>
      ) : (
        <ul className="flex max-w-[640px] flex-col gap-2.5">
          {connections.map((connection) => (
            <li key={connection.oauthClientId} className="flex items-center gap-3 rounded-lg bg-surface p-4 shadow-card">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">{connection.clientName}</div>
                <div className="text-xs text-ink-muted">
                  Verbunden seit {dateTime(connection.connectedAt)} ·{' '}
                  {connection.lastUsedAt ? `zuletzt benutzt ${dateTime(connection.lastUsedAt)}` : 'noch nicht benutzt'} ·{' '}
                  {connection.scope.includes('mcp:write') ? 'Lesen und Schreiben' : 'Nur Lesen'}
                </div>
              </div>
              <form action={revokeMyConnection.bind(null, connection.oauthClientId)}>
                <button
                  type="submit"
                  aria-label={`Verbindung zu ${connection.clientName} beenden`}
                  className="min-h-11 rounded-md border border-line-strong px-3 text-sm font-semibold text-red-700">
                  Beenden
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
