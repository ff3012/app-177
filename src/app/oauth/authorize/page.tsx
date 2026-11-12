import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getMcpAccessOf } from '@/lib/mcp/access-db';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { buildRedirect } from '@/lib/mcp/oauth/redirect-uris';
import { grantedScope } from '@/lib/mcp/oauth/scopes';
import { AUTHORIZE_PARAM_NAMES, validateAuthorizeRequest } from '@/lib/mcp/oauth/service';
import { approveAuthorization, denyAuthorization } from './actions';

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-2 text-xl font-semibold text-neutral-900">{title}</h1>
        <p className="text-sm text-neutral-600">{message}</p>
      </div>
    </div>
  );
}

// Bekannte Einschränkung: Die Anmeldung per E-Mail-Token (Link/Code) kehrt nicht zu /oauth/authorize zurück. Wer so
// angemeldet ist, startet die Verbindung in Claude/ChatGPT erneut; die Sitzung besteht dann und er landet direkt hier.

// Immer dynamisch: hängt vom Funktionsschalter, von der Sitzung und den Query-Parametern ab.
export const dynamic = 'force-dynamic';

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await isMcpEnabled())) notFound();
  const user = await requireUser();

  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const value = raw[name];
    params[name] = Array.isArray(value) ? value[0] : value;
  }

  const result = await validateAuthorizeRequest(params);
  if (!result.ok) {
    if (result.fatal) return <ErrorCard title="Anmeldung nicht möglich" message={result.message} />;
    redirect(buildRedirect(result.redirectUri, { error: result.error, error_description: result.errorDescription, state: result.state }));
  }

  const access = await getMcpAccessOf(user.id);
  const scope = grantedScope(result.request.scope, access);
  if (access === 'NONE') {
    return (
      <ErrorCard
        title="Kein Zugriff"
        message="Dein Konto hat keinen Zugriff auf den KI-Connector. Bitte wende dich an einen Admin deiner Feuerwehr."
      />
    );
  }
  if (!scope) {
    return <ErrorCard title="Umfang nicht erlaubt" message="Die Anwendung verlangt mehr Rechte, als dein Konto hat." />;
  }

  const canWrite = scope.split(' ').includes('mcp:write');
  const redirectHost = new URL(result.request.redirectUri).host;
  const hidden = AUTHORIZE_PARAM_NAMES.map((name) => (params[name] ? <input key={name} type="hidden" name={name} value={params[name]} /> : null));

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Zugriff erlauben?</h1>
        <p className="mb-4 text-sm text-neutral-600">
          <strong>{result.request.clientName}</strong> möchte sich im Namen von <strong>{user.name}</strong> mit der Feuerwehr-App
          verbinden.
        </p>
        <p className="mb-4 text-xs text-neutral-500">Rückleitung an: {redirectHost}</p>
        <ul className="mb-4 list-disc pl-5 text-sm text-neutral-700">
          <li>Daten abfragen, die du auch in der App sehen darfst (Benutzer, Drohnengruppe, Kalender, Atemschutz)</li>
          {canWrite && <li>Neue Benutzer anlegen, soweit du das in der App darfst</li>}
        </ul>
        <p className="mb-6 text-xs text-neutral-500">Du kannst die Verbindung jederzeit in deinem Profil unter "Verbundene KI-Apps" beenden.</p>
        <div className="flex gap-3">
          <form action={approveAuthorization} className="flex-1">
            {hidden}
            <button type="submit" className="min-h-11 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
              Erlauben
            </button>
          </form>
          <form action={denyAuthorization} className="flex-1">
            {hidden}
            <button type="submit" className="min-h-11 w-full rounded-md border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink">
              Ablehnen
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
