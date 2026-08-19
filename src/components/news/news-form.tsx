'use client';

import { useMemo, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { newsSchema, type NewsInput } from '@/lib/validation/news.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
// Bewusst aus dem import-freien truncate-for-push.ts statt aus dispatch-news.ts: Letzteres importiert
// prisma und web-push-client (Node-only, u.a. `net`/`tls`) - ein Import davon in dieser
// Client-Komponente ließ `next build` mit "Module not found: Can't resolve 'net'" fehlschlagen
// (live bestätigt), da Next.js dem gesamten Modulgraphen ins Browser-Bundle folgt.
import { truncateForPush } from '@/lib/news/truncate-for-push';
import type { NewsFormState } from '@/app/(app)/news/actions';

interface RecipientStats {
  id: string;
  name: string;
  memberCount: number;
  pushCount: number;
}

interface EventOption {
  id: string;
  label: string;
  organizationId: string;
  droneGroupId: string | null;
  isDroneEvent: boolean;
}

/** Vorbelegung für den Bearbeiten-Fall (Task 7) - alle Felder optional, da die Erstellen-Seite (Task 6)
 * diesen Prop schlicht wegLässt statt einen leeren Platzhalter durchzureichen. */
interface ExistingNewsPost {
  title: string;
  body: string;
  audience: NewsInput['audience'];
  fireDepartmentId: string | null;
  droneGroupId: string | null;
  eventId: string | null;
  scheduledAt: Date | null;
}

interface NewsFormProps {
  fireDepartments: RecipientStats[];
  droneGroups: RecipientStats[];
  bezirksweitStats: { memberCount: number; pushCount: number } | null;
  events: EventOption[];
  existingPost?: ExistingNewsPost;
  action: (prevState: NewsFormState, formData: FormData) => Promise<NewsFormState>;
}

/** Formatiert ein Date als Wert für DateTime15MinInput (datetime-local-artig, lokale Zeit) - identisch
 * zu toDatetimeLocalValue in src/lib/format.ts, hier nicht importiert um diese reine UI-Komponente
 * nicht von einer weiteren Datei abhängig zu machen für eine einzige Zeile. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function NewsForm({ fireDepartments, droneGroups, bezirksweitStats, events, existingPost, action }: NewsFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [confirmMode, setConfirmMode] = useState<'SCHEDULED' | 'NOW' | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<NewsInput>({
    resolver: zodResolver(newsSchema),
    defaultValues: {
      title: existingPost?.title ?? '',
      body: existingPost?.body ?? '',
      // Default-Zielgruppe hängt davon ab, was DIESER Nutzer überhaupt senden darf: fireDepartments ist
      // leer für einen reinen Drohnengruppen-Admin (siehe /news/neu's Server-seitige Filterung nach
      // canSendNewsToFireDepartment/canSendNewsToDroneGroup) - ohne diesen Fallback bliebe für ihn
      // 'FIRE_DEPARTMENT' mit leerem fireDepartmentId voreingestellt und KEINE Kachel wäre beim ersten
      // Rendern ausgewählt, obwohl er genau eine Gruppe zur Auswahl hat.
      audience: existingPost?.audience ?? (fireDepartments.length > 0 ? 'FIRE_DEPARTMENT' : 'DRONE_GROUP'),
      fireDepartmentId: existingPost?.fireDepartmentId ?? fireDepartments[0]?.id ?? '',
      droneGroupId: existingPost?.droneGroupId ?? (fireDepartments.length === 0 ? droneGroups[0]?.id ?? '' : ''),
      eventId: existingPost?.eventId ?? '',
      // 'DRAFT' bleibt der Default auch beim Bearbeiten - ein Entwurf/terminierter Beitrag wird nach dem
      // Öffnen des Formulars nicht automatisch erneut "Jetzt gesendet", nur weil er bearbeitet wird; der
      // Nutzer wählt beim Speichern erneut explizit einen der drei Buttons.
      sendMode: 'DRAFT',
      scheduledAt: existingPost?.scheduledAt ? toLocalInputValue(existingPost.scheduledAt) : '',
    },
  });

  const audience = watch('audience');
  const fireDepartmentId = watch('fireDepartmentId');
  const droneGroupId = watch('droneGroupId');
  const title = watch('title');
  const body = watch('body');

  const selectedStats =
    audience === 'FIRE_DEPARTMENT'
      ? fireDepartments.find((org) => org.id === fireDepartmentId)
      : droneGroupId
        ? droneGroups.find((group) => group.id === droneGroupId)
        : bezirksweitStats;

  const relevantEvents = useMemo(
    () =>
      events.filter((event) =>
        audience === 'FIRE_DEPARTMENT' ? !event.isDroneEvent && event.organizationId === fireDepartmentId : event.isDroneEvent,
      ),
    [events, audience, fireDepartmentId],
  );

  const previewCut = truncateForPush(body || '');
  const previewVisibleLength = previewCut.endsWith('…') ? previewCut.length - 1 : previewCut.length;
  const previewHiddenPart = (body || '').slice(previewVisibleLength);

  function buildFormData(values: NewsInput): FormData {
    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('body', values.body);
    formData.set('audience', values.audience);
    formData.set('fireDepartmentId', values.fireDepartmentId ?? '');
    formData.set('droneGroupId', values.droneGroupId ?? '');
    formData.set('eventId', values.eventId ?? '');
    formData.set('sendMode', values.sendMode);
    formData.set('scheduledAt', values.scheduledAt ?? '');
    return formData;
  }

  function submitWithMode(values: NewsInput, sendMode: NewsInput['sendMode']) {
    startTransition(async () => {
      const result = await action({}, buildFormData({ ...values, sendMode }));
      setServerError(result?.error);
    });
  }

  function onSubmitDraft(values: NewsInput) {
    submitWithMode(values, 'DRAFT');
  }

  function onRequestScheduled(values: NewsInput) {
    // sendMode bleibt bewusst unangetastet, solange kein scheduledAt gesetzt ist: ein vorheriger Bug
    // setzte hier `sendMode: 'SCHEDULED'` per setValue auch ohne Datum und nie wieder zurück - da das
    // Zod-refine scheduledAt bei sendMode === 'SCHEDULED' zwingend verlangt, blockierte das dauerhaft
    // auch "Als Entwurf speichern"/"Jetzt senden" in derselben Formular-Session. Stattdessen nur den
    // Fehler am scheduledAt-Feld setzen - die anderen beiden Buttons bleiben davon unberührt.
    if (!values.scheduledAt) {
      setError('scheduledAt', { type: 'manual', message: 'Datum/Uhrzeit ist erforderlich.' });
      return;
    }
    setConfirmMode('SCHEDULED');
  }

  function onRequestNow() {
    setConfirmMode('NOW');
  }

  function confirmSend() {
    if (!confirmMode) return;
    const values = { ...watch(), sendMode: confirmMode };
    setConfirmMode(null);
    submitWithMode(values, confirmMode);
  }

  const recipientLabel =
    audience === 'FIRE_DEPARTMENT'
      ? fireDepartments.find((org) => org.id === fireDepartmentId)?.name
      : droneGroupId
        ? droneGroups.find((group) => group.id === droneGroupId)?.name ?? 'Alle Drohnengruppen'
        : 'Alle Drohnengruppen';

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <form onSubmit={handleSubmit(onSubmitDraft)} className="flex max-w-lg flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-neutral-700">Empfänger</label>
          <div className="grid grid-cols-2 gap-2">
            {fireDepartments.map((org) => (
              <label
                key={org.id}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  audience === 'FIRE_DEPARTMENT' && fireDepartmentId === org.id ? 'border-brand bg-brand/5' : 'border-neutral-200'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={audience === 'FIRE_DEPARTMENT' && fireDepartmentId === org.id}
                  onChange={() => {
                    setValue('audience', 'FIRE_DEPARTMENT');
                    setValue('fireDepartmentId', org.id);
                  }}
                />
                <span className="block font-medium text-neutral-900">{org.name}</span>
                <span className="text-xs text-neutral-500">
                  {org.memberCount} Mitglieder · {org.pushCount} mit Push
                </span>
              </label>
            ))}
            {droneGroups.map((group) => (
              <label
                key={group.id}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  audience === 'DRONE_GROUP' && droneGroupId === group.id ? 'border-brand bg-brand/5' : 'border-neutral-200'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={audience === 'DRONE_GROUP' && droneGroupId === group.id}
                  onChange={() => {
                    setValue('audience', 'DRONE_GROUP');
                    setValue('droneGroupId', group.id);
                  }}
                />
                <span className="block font-medium text-neutral-900">{group.name}</span>
                <span className="text-xs text-neutral-500">
                  {group.memberCount} Mitglieder · {group.pushCount} mit Push
                </span>
              </label>
            ))}
            {bezirksweitStats && (
              <label
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  audience === 'DRONE_GROUP' && !droneGroupId ? 'border-brand bg-brand/5' : 'border-neutral-200'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={audience === 'DRONE_GROUP' && !droneGroupId}
                  onChange={() => {
                    setValue('audience', 'DRONE_GROUP');
                    setValue('droneGroupId', '');
                  }}
                />
                <span className="block font-medium text-neutral-900">Alle Drohnengruppen</span>
                <span className="text-xs text-neutral-500">
                  {bezirksweitStats.memberCount} Mitglieder · {bezirksweitStats.pushCount} mit Push
                </span>
              </label>
            )}
          </div>
          {errors.fireDepartmentId && <p className="text-sm text-red-700">{errors.fireDepartmentId.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Titel</label>
          <input {...register('title')} className="rounded border border-neutral-300 px-3 py-2" />
          <p className="text-xs text-neutral-400">{title?.length ?? 0} / 65 — der Push-Kopf wird nie gekürzt.</p>
          {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Nachricht</label>
          <textarea {...register('body')} rows={6} className="rounded border border-neutral-300 px-3 py-2" />
          <p className="text-xs text-neutral-400">
            {body?.length ?? 0} Zeichen · Länge unbegrenzt. Der volle Text steht in der App, unabhängig davon, was der Push zeigt.
          </p>
          {errors.body && <p className="text-sm text-red-700">{errors.body.message}</p>}
        </div>

        {relevantEvents.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700">Termin verknüpfen (optional)</label>
            <select {...register('eventId')} className="rounded border border-neutral-300 px-3 py-2">
              <option value="">Kein Termin</option>
              {relevantEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <Controller
          control={control}
          name="scheduledAt"
          render={({ field }) => (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-neutral-700">Terminieren für (optional)</label>
              <DateTime15MinInput value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} />
              {errors.scheduledAt && <p className="text-sm text-red-700">{errors.scheduledAt.message}</p>}
            </div>
          )}
        />

        {selectedStats && (
          <p className="text-sm text-neutral-600">
            Wird an {selectedStats.pushCount} Geräte gesendet. {selectedStats.memberCount - selectedStats.pushCount} Mitglieder haben
            Push deaktiviert und sehen die Nachricht beim nächsten Öffnen von /news.
          </p>
        )}

        {serverError && <p className="text-sm text-red-700">{serverError}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="rounded border border-neutral-300 px-4 py-2 font-medium text-neutral-700 disabled:opacity-60">
            Als Entwurf speichern
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleSubmit(onRequestScheduled)}
            className="rounded border border-brand px-4 py-2 font-medium text-brand disabled:opacity-60"
          >
            Terminieren
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleSubmit(onRequestNow)}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Jetzt senden
          </button>
          <Link href="/news" className="text-sm text-neutral-600 hover:underline">
            Abbrechen
          </Link>
        </div>
      </form>

      <div className="flex-1 rounded-lg bg-neutral-50 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Push-Vorschau</p>
        <div className="rounded-xl bg-white p-3 shadow">
          <p className="text-xs font-medium text-neutral-500">AFKDO Purkersdorf</p>
          <p className="text-sm font-semibold text-neutral-900">{title || 'Titel'}</p>
          <p className="text-sm text-neutral-700">
            {previewCut.endsWith('…') ? previewCut.slice(0, -1) : previewCut}
            {previewHiddenPart && <span className="bg-red-100 text-red-700">{previewHiddenPart}</span>}
            {previewCut.endsWith('…') && '…'}
          </p>
        </div>
        <p className="mt-2 text-xs text-neutral-500">Im Push sichtbar: {previewVisibleLength} Zeichen</p>
        <p className="mt-2 rounded bg-green-50 p-2 text-xs text-green-800">
          Der Tap auf die Meldung öffnet die vollständige Nachricht.
        </p>
      </div>

      <AlertDialog open={confirmMode !== null} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmMode === 'NOW' ? 'Jetzt senden?' : 'Terminieren?'}</AlertDialogTitle>
            <AlertDialogDescription>
              Wird an {recipientLabel} gesendet{selectedStats ? ` (${selectedStats.pushCount} Geräte)` : ''}. Ein Push ist nicht
              zurückholbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={confirmSend}>
              {confirmMode === 'NOW' ? 'Jetzt senden' : 'Terminieren'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
