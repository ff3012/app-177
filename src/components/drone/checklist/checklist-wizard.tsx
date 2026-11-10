'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ChecklistData } from '@/lib/drone/checklist/data';
import { CONNECTION_ERROR, createAutosaver } from '@/lib/drone/checklist/autosave';
import { STEP_SUBTITLES, STEP_TITLES, TOTAL_STEPS } from '@/lib/drone/checklist/labels';
import { missingForSubmit, stepGate } from '@/lib/drone/checklist/rules';
import { saveChecklistAction, submitChecklistAction } from '@/app/(app)/drohnen/checkliste/actions';
import {
  StepAbschluss,
  StepBetrieb,
  StepEinsatzdaten,
  StepEinsatzende,
  StepFluege,
  StepGrundlage,
  StepTeam,
  StepVorbereitung,
  StepVorflug,
  type DroneOption,
  type PersonOption,
} from './wizard-steps';

const AUTOSAVE_MS = 2000;

function timeLabel(date: Date): string {
  return date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
}

interface Props {
  checklistId: string;
  initialData: ChecklistData;
  initialStep: number;
  members: PersonOption[];
  drones: DroneOption[];
  userId: string;
  /** Admin oder BOS1-Pilot der Gruppe: darf unabhängig vom gewählten Piloten bestätigen. */
  canConfirmAny: boolean;
  /** Nur lesen (fremder Entwurf ohne Bearbeitungsrecht). */
  readOnly: boolean;
}

/** Vollbild-Wizard (liegt über Kopfzeile und Tab-Bar der App). Autosave 2 s nach der letzten Änderung und bei
 * jedem Schrittwechsel; "Schließen" speichert immer zuerst. */
export function ChecklistWizard({ checklistId, initialData, initialStep, members, drones, userId, canConfirmAny, readOnly }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ChecklistData>(initialData);
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), TOTAL_STEPS - 1));
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dataRef = useRef(data);
  const stepRef = useRef(step);
  const lastErrorRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Autosave 2 s nach der letzten Änderung; wirft nie, Fehler landen in saveError.
  const saverRef = useRef<ReturnType<typeof createAutosaver> | null>(null);
  if (!saverRef.current) {
    saverRef.current = createAutosaver({
      save: () => saveChecklistAction(checklistId, stepRef.current, dataRef.current),
      onSaved: (at) => {
        lastErrorRef.current = null;
        setSavedAt(at);
        setSaveError(null);
      },
      onError: (message) => {
        lastErrorRef.current = message;
        setSaveError(message);
      },
      delayMs: AUTOSAVE_MS,
    });
  }
  const saver = saverRef.current;
  useEffect(() => () => saver.dispose(), [saver]);

  const update = useCallback(
    (patch: Partial<ChecklistData>) => {
      if (readOnly) return;
      const next = { ...dataRef.current, ...patch };
      dataRef.current = next;
      setData(next);
      saver.markDirty();
    },
    [saver, readOnly],
  );

  const goToStep = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), TOTAL_STEPS - 1);
      stepRef.current = clamped;
      setStep(clamped);
      if (!readOnly) {
        // Der geöffnete Schritt wird mitgespeichert, damit "Fortsetzen" dort weitermacht.
        saver.markDirty();
        void saver.flush();
      }
      window.history.replaceState(null, '', `?schritt=${clamped}`);
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [saver, readOnly],
  );

  async function handleClose() {
    if (!readOnly) {
      saver.markDirty();
      const ok = await saver.flush();
      if (!ok) {
        toast.error(lastErrorRef.current ?? 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
        return;
      }
      toast.success('Als Entwurf gespeichert · später fortsetzen');
    }
    router.push('/drohnen');
    router.refresh();
  }

  async function handleSaveNow() {
    saver.markDirty();
    const ok = await saver.flush();
    if (ok) toast.success(`Zwischengespeichert um ${timeLabel(new Date())}`);
    else toast.error(lastErrorRef.current ?? 'Speichern fehlgeschlagen.');
  }

  function handleNext() {
    const gate = stepGate(step, dataRef.current);
    if (gate) {
      toast.error(gate);
      return;
    }
    goToStep(step + 1);
  }

  async function handleSubmit() {
    const missing = missingForSubmit(dataRef.current);
    if (missing.length > 0) {
      toast.error(`Es fehlen noch Angaben: ${missing[0].text}`);
      return;
    }
    setSubmitting(true);
    saver.dispose();
    try {
      const result = await submitChecklistAction(checklistId, dataRef.current);
      if (result.ok) {
        router.push(`/drohnen/checkliste/${checklistId}/fertig`);
        return;
      }
      setSubmitting(false);
      saver.markDirty();
      toast.error(result.missing?.length ? `Es fehlen noch Angaben: ${result.missing[0].text}` : result.error);
    } catch (error) {
      // Z. B. ohne Netz oder nach einem Deploy mit veralteter Server-Action-ID - nie in "Wird abgesendet" hängen bleiben.
      console.error('Checkliste: Absenden fehlgeschlagen', error);
      setSubmitting(false);
      saver.markDirty();
      toast.error(CONNECTION_ERROR);
    }
  }

  // Der gewählte Pilot kann sich in Schritt 3 noch ändern - die Bestätigungsberechtigung folgt ihm.
  const canConfirm = canConfirmAny || data.pilot === userId;
  const gate = stepGate(step, data);
  const missing = missingForSubmit(data);
  const isLast = step === TOTAL_STEPS - 1;
  const stepProps = { data, update, members, drones };

  const footerNote = readOnly
    ? 'Nur Ansicht – Sie können diesen Entwurf nicht bearbeiten.'
    : gate
      ? gate
      : saveError
        ? `Speichern fehlgeschlagen: ${saveError}`
        : savedAt
          ? `Entwurf gespeichert um ${timeLabel(savedAt)}`
          : 'Änderungen werden automatisch gespeichert.';
  const footerNoteIsError = !readOnly && (!!gate || !!saveError);

  return (
    <div className="fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-[#f6f6f7]">
      <header className="shrink-0 bg-ink pt-[max(10px,env(safe-area-inset-top,0px))] text-white">
        <p className="mx-auto w-full max-w-[560px] px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-[.12em] text-white/70">
          Checkliste Drohnenflug
        </p>
        <div className="mx-auto w-full max-w-[560px] px-4 pb-3">
          <h1 className="text-[23px] font-bold leading-tight">{STEP_TITLES[step]}</h1>
          <p className="text-[13px] text-white/75">
            Schritt {step + 1} von {TOTAL_STEPS} · {STEP_SUBTITLES[step]}
          </p>
          <div className="mt-2.5 flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step + 1}>
            {STEP_TITLES.map((title, index) => (
              <button
                key={title}
                type="button"
                aria-label={`Zu Schritt ${index + 1}: ${title}`}
                onClick={() => index <= step && goToStep(index)}
                className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-[#1f8a5b]' : index === step ? 'bg-white' : 'bg-white/25'}`}
              />
            ))}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={readOnly || submitting} className="mx-auto flex w-full max-w-[560px] flex-col gap-3.5 px-4 py-4">
          {step === 0 && <StepEinsatzdaten {...stepProps} />}
          {step === 1 && <StepGrundlage {...stepProps} />}
          {step === 2 && <StepTeam {...stepProps} />}
          {step === 3 && <StepVorbereitung {...stepProps} />}
          {step === 4 && <StepVorflug {...stepProps} />}
          {step === 5 && <StepBetrieb {...stepProps} />}
          {step === 6 && <StepFluege {...stepProps} />}
          {step === 7 && <StepEinsatzende {...stepProps} />}
          {step === 8 && <StepAbschluss {...stepProps} canConfirm={canConfirm} goToStep={goToStep} />}
        </fieldset>
      </div>

      <footer className="shrink-0 border-t border-line bg-surface pb-[max(12px,env(safe-area-inset-bottom,0px))] pt-2.5">
        <div className="mx-auto w-full max-w-[560px] px-4">
          <div className="grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0 || submitting}
              className="min-h-12 touch-manipulation rounded-lg border border-line-strong bg-surface text-[15px] font-semibold text-ink disabled:opacity-40"
            >
              Zurück
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={readOnly || submitting}
                aria-disabled={missing.length > 0}
                className={`col-span-2 min-h-12 rounded-lg text-[15px] font-bold text-white disabled:opacity-60 ${missing.length > 0 ? 'bg-neutral-400' : 'bg-[#d42a23]'}`}
              >
                {submitting ? 'Wird abgesendet …' : 'Checkliste absenden'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={submitting}
                aria-disabled={!!gate}
                className={`col-span-2 min-h-12 rounded-lg text-[15px] font-bold text-white ${gate ? 'bg-neutral-400' : 'bg-ink'}`}
              >
                Weiter · {STEP_TITLES[step + 1]}
              </button>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="min-h-11 touch-manipulation rounded-lg border border-line-strong bg-surface text-[14px] font-semibold text-ink disabled:opacity-40"
            >
              Schließen
            </button>
            {readOnly ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={handleSaveNow}
                disabled={submitting}
                className="min-h-11 touch-manipulation rounded-lg border border-line-strong bg-surface text-[14px] font-semibold text-ink disabled:opacity-40"
              >
                Speichern
              </button>
            )}
          </div>
          <p className={`mt-1.5 text-center text-xs ${footerNoteIsError ? 'font-semibold text-red-700' : 'text-ink-muted'}`}>{footerNote}</p>
        </div>
      </footer>
    </div>
  );
}
