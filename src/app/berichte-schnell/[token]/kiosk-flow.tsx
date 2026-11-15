'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReportWizard } from '@/app/(app)/meine-feuerwehr/berichte/neu/report-wizard';
import { NotificationFormView } from '@/components/heimatfeuerwehr/notification-form-view';
import { getKioskTiles, type KioskTile } from '@/lib/heimatfeuerwehr/kiosk-tiles';
import { NOTIFICATION_FORM_LABEL, type NotificationFormState } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import type { NotificationForm, ReportType } from '@prisma/client';
import { submitNotificationViaKiosk, submitReportViaKiosk } from './actions';
import { KioskFormScreen } from './kiosk-form-screen';
import { KioskHeader } from './kiosk-header';
import { WizardFrame } from './wizard-frame';

export interface KioskFlowProps {
  token: string;
  organizationName: string;
  deviceName: string | null;
  enabledTypes: string[];
  notificationForms: Record<NotificationForm, { state: NotificationFormState; products: string[] }>;
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentKindsByType: Record<string, string[]>;
}

type Target = { kind: 'report'; type: ReportType } | { kind: 'form'; form: NotificationForm };

type Phase =
  | { phase: 'form' }
  | { phase: 'name'; target: Target }
  | { phase: 'wizard'; filledById: string; type: ReportType; run: number }
  | { phase: 'notify'; filledById: string; form: NotificationForm; run: number }
  | { phase: 'done'; kind: 'report' | 'notification'; number?: number; year?: number };

const DONE_RESET_MS = 30_000;

/**
 * Ablauf der iPad-Schnellerfassung als reiner Client-Zustand: Formular (Kacheln) -> Namenswahl -> Assistent (Bericht) bzw.
 * Meldeformular (Getränkeautomat/Schadensmeldung) -> Bestätigung -> (nach 30 s oder "Neues Formular") zurück zum
 * Formularbildschirm. Damit bleibt keine Person auf dem gemeinsamen Gerät "angemeldet", und die Eingaben der Vorgängerin
 * sind weg (Assistent und Meldeformular halten ihren Zustand nur im Browser-Speicher und werden bei jedem Lauf neu
 * eingehängt). Die Elementstruktur der Phasen hängt nie vom Layout ab: ein Layoutwechsel (Drehen) hängt nichts neu ein.
 */
export function KioskFlow({
  token,
  organizationName,
  deviceName,
  enabledTypes,
  notificationForms,
  members,
  vehicles,
  recentKindsByType,
}: KioskFlowProps) {
  const [state, setState] = useState<Phase>({ phase: 'form' });
  const [run, setRun] = useState(0);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'mobile' | 'tablet'>('tablet');

  // Ab 1024 px das Tablet-Layout, darunter fällt der Assistent auf das Handy-Layout zurück.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const apply = () => setLayout(query.matches ? 'tablet' : 'mobile');
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const reset = useCallback(() => {
    setSearch('');
    setState({ phase: 'form' });
  }, []);

  // Nach der Bestätigung automatisch zurück zum Formularbildschirm; der Timer wird beim Verlassen der Phase gelöscht.
  const isDone = state.phase === 'done';
  useEffect(() => {
    if (!isDone) return;
    const timer = setTimeout(reset, DONE_RESET_MS);
    return () => clearTimeout(timer);
  }, [isDone, reset]);

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => `${member.lastName} ${member.firstName}`.toLowerCase().includes(needle));
  }, [members, search]);

  if (state.phase === 'wizard') {
    const filledBy = members.find((member) => member.id === state.filledById);
    const wizard = (
      <ReportWizard
        key={state.run}
        type={state.type}
        filledById={state.filledById}
        members={members}
        vehicles={vehicles}
        recentActivityKinds={recentKindsByType[state.type] ?? []}
        layout={layout}
        lockFilledBy
        tabletHeader={{
          title: `${REPORT_TYPE_LABEL[state.type]} · ${organizationName}`,
          subtitle: filledBy ? `Ausfüller: ${filledBy.firstName} ${filledBy.lastName}` : undefined,
        }}
        onSubmit={(payload) => submitReportViaKiosk(token, payload)}
        onDone={(result) => setState({ phase: 'done', kind: 'report', number: result.number, year: result.year })}
        onCancel={reset}
      />
    );
    // Stabiler Rahmen in beiden Layouts: ein Layoutwechsel (Drehen) darf den Assistenten nicht neu einhängen.
    return <WizardFrame layout={layout}>{wizard}</WizardFrame>;
  }

  if (state.phase === 'notify') {
    const sender = members.find((member) => member.id === state.filledById);
    return (
      <div className="flex min-h-[100dvh] touch-manipulation flex-col bg-[#f6f6f7] text-[#1c1c1e]">
        <KioskHeader organizationName={organizationName} title={NOTIFICATION_FORM_LABEL[state.form]} deviceName={deviceName} />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">
          {sender && (
            <p className="mb-4 text-sm text-neutral-500">
              Meldung von {sender.firstName} {sender.lastName}
            </p>
          )}
          <NotificationFormView
            key={state.run}
            form={state.form}
            products={notificationForms[state.form].products}
            layout={layout}
            onSubmit={(input) => submitNotificationViaKiosk(token, state.filledById, input)}
            onDone={() => setState({ phase: 'done', kind: 'notification' })}
            onCancel={reset}
          />
        </main>
      </div>
    );
  }

  const tiles = getKioskTiles(
    enabledTypes,
    Object.fromEntries(Object.entries(notificationForms).map(([form, value]) => [form, value.state])),
  );
  const headerTitle =
    state.phase === 'form'
      ? 'Welches Formular ausfüllen?'
      : state.phase === 'name'
        ? state.target.kind === 'report'
          ? 'Wer schreibt den Bericht?'
          : 'Wer macht die Meldung?'
        : state.kind === 'notification'
          ? 'Meldung gesendet'
          : 'Bericht abgegeben';

  return (
    <div className="flex min-h-[100dvh] touch-manipulation flex-col bg-[#f6f6f7] text-[#1c1c1e]">
      <KioskHeader organizationName={organizationName} title={headerTitle} deviceName={deviceName} />

      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        {state.phase === 'form' && (
          <KioskFormScreen
            tiles={tiles}
            onChoose={(tile: KioskTile) => {
              if (tile.state !== 'active') return;
              if (tile.type) {
                setSearch('');
                setState({ phase: 'name', target: { kind: 'report', type: tile.type } });
              } else if (tile.form) {
                setSearch('');
                setState({ phase: 'name', target: { kind: 'form', form: tile.form } });
              }
            }}
          />
        )}

        {state.phase === 'name' && (
          <>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name suchen …"
              className="mb-5 min-h-[52px] w-full rounded-lg border border-neutral-300 bg-white px-4 text-base"
            />
            {filteredMembers.length === 0 ? (
              <p className="py-8 text-center text-base text-neutral-500">Keine Treffer.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 lg:grid-cols-4">
                {filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      // Jeder Lauf bekommt einen neuen key, damit Assistent bzw. Meldeformular mit leerem Zustand starten.
                      const nextRun = run + 1;
                      setRun(nextRun);
                      setState(
                        state.target.kind === 'report'
                          ? { phase: 'wizard', filledById: member.id, type: state.target.type, run: nextRun }
                          : { phase: 'notify', filledById: member.id, form: state.target.form, run: nextRun },
                      );
                    }}
                    className="min-h-[64px] rounded-xl border border-neutral-300 bg-white px-4 py-3 text-left text-[16px] font-semibold shadow-sm"
                  >
                    {member.lastName} {member.firstName}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={reset} className="mt-6 min-h-[52px] rounded-lg border border-neutral-300 bg-white px-6 text-[15px] font-semibold">
              ← Anderes Formular
            </button>
          </>
        )}

        {state.phase === 'done' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            {state.kind === 'report' && state.number !== undefined && state.year !== undefined && (
              <p className="text-lg text-neutral-600">
                Nr. {state.number} / {state.year}
              </p>
            )}
            <button type="button" onClick={reset} className="mt-4 min-h-[56px] rounded-lg bg-brand px-10 text-[16px] font-semibold text-white">
              Neues Formular
            </button>
            <p className="text-sm text-neutral-400">Der Bildschirm wechselt nach 30 Sekunden von selbst zurück.</p>
          </div>
        )}
      </main>
    </div>
  );
}
