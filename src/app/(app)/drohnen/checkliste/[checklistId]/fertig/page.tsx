import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canDownloadChecklistPdf } from '@/lib/auth/permissions';
import { getChecklistView, checklistTitle } from '@/lib/drone/checklist/queries';
import { checklistPdfFileName } from '@/lib/drone/checklist/mail';
import { viennaDateParts } from '@/lib/drone/checklist/columns';

export default async function ChecklisteFertigPage({ params }: { params: Promise<{ checklistId: string }> }) {
  const user = await requireUser();
  const { checklistId } = await params;
  const view = await getChecklistView(user, checklistId);
  if (!view) notFound();
  const { checklist } = view;
  if (checklist.status === 'DRAFT') redirect(`/drohnen/checkliste/${checklistId}`);

  const { datum, zeit } = viennaDateParts(checklist.flightAt);
  const [y, m, d] = datum.split('-');
  const canPdf = canDownloadChecklistPdf(user, checklist, view.droneGroup);
  const submitted = checklist.status === 'SUBMITTED';

  // Versand läuft nach dem Abgeben im Hintergrund - bis dahin steht weder mailedAt noch mailError.
  const mailState = checklist.mailedAt
    ? { tone: 'text-ink', text: `Per E-Mail gesendet an ${checklist.mailedTo ?? '-'} · Anhang ${checklistPdfFileName(checklist.flightAt, checklist.area)}` }
    : checklist.mailError
      ? { tone: 'text-red-700', text: `Versand nicht erfolgt: ${checklist.mailError}. Die Drohnenverwaltung kann die Mail erneut senden.` }
      : { tone: 'text-ink-muted', text: 'Versand ausstehend – die Mail wird gerade erstellt.' };

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4">
      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1f8a5b] text-3xl text-white" aria-hidden>
          ✓
        </div>
        <h1 className="text-[24px] font-bold text-ink">{submitted ? 'Checkliste übermittelt' : 'Checkliste verworfen'}</h1>
        <p className="text-ink-muted">
          {checklistTitle(checklist)} · {d}.{m}.{y} {zeit}
        </p>
      </div>

      {submitted && (
        <div className="rounded-xl bg-surface p-4 shadow-card">
          <p className={`text-sm ${mailState.tone}`}>{mailState.text}</p>
          {canPdf && (
            <a href={`/drohnen/checkliste/${checklistId}/pdf`} className="mt-2 inline-block text-sm font-semibold text-brand hover:underline">
              PDF herunterladen
            </a>
          )}
        </div>
      )}

      {submitted && (
        <Link
          href={`/drohnen/neu?checkliste=${checklistId}&gruppe=${view.droneGroup.id}`}
          className="flex min-h-12 items-center justify-center rounded-lg bg-[#d42a23] px-4 text-[15px] font-bold text-white"
        >
          Flug aus dieser Checkliste registrieren
        </Link>
      )}
      <Link href="/drohnen" className="flex min-h-12 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-[15px] font-semibold text-ink">
        Zurück zum Flugbuch
      </Link>
    </div>
  );
}
