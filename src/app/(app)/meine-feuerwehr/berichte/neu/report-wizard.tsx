'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MemberSearchSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-search-select';
import { MemberMultiSelect } from '@/components/heimatfeuerwehr/member-multi-select';
import {
  ACTIVITY_KINDS,
  MATERIALS,
  EQUIPMENT,
  LOESCHER_CODES,
  FUNKTION_LABEL,
} from '@/lib/heimatfeuerwehr/report-constants';
import { ActivityKindPicker } from './activity-kind-picker';
import { submitReport, type SubmitReportInput } from '../submit-actions';
import type { ReportType } from '@prisma/client';

const FUNKTIONEN = ['KOMMANDANT', 'FAHRER', 'MANNSCHAFT'] as const;

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function toTimeInputValue(date: Date): string {
  return date.toTimeString().slice(0, 5);
}
function combine(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function WizardHeader({ step, onBack }: { step: 1 | 2 | 3; onBack: () => void }) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {step === 1 ? (
          <Link href="/meine-feuerwehr" className="text-sm font-medium text-brand">
            ‹ Abbrechen
          </Link>
        ) : (
          <button type="button" onClick={onBack} className="text-sm font-medium text-brand">
            ‹ Zurück
          </button>
        )}
        <span className="text-xs font-medium text-neutral-500">Schritt {step} von 3</span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-brand' : 'bg-neutral-200'}`} />
        ))}
      </div>
    </div>
  );
}

interface ReportMemberEntry {
  userId: string;
  funktion: (typeof FUNKTIONEN)[number];
}

/**
 * Der gesamte 3-Schritt-Assistent als eine Client Component - kein Entwurf-Konzept mehr, also keine
 * serverseitige Zwischenspeicherung: alle Eingaben leben rein in diesem Komponenten-State, "Weiter"/
 * "Zurück" sind nur lokale step-Wechsel (kein Routenwechsel, kein Verlust von React-State), erst
 * "Bericht abgeben" schickt alles auf einmal an submitReport. Verwirft man die Seite vorher (Tab
 * schließen, "Abbrechen"), ist nichts in der DB - das ist gewollt, nicht mehr ein zu behebender Bug.
 */
export function ReportWizard({
  type,
  filledById: initialFilledById,
  members,
  vehicles,
  recentActivityKinds,
}: {
  type: ReportType;
  filledById: string;
  members: ReportMemberOption[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentActivityKinds: string[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const now = useState(() => new Date())[0];
  const oneHourLater = useState(() => new Date(now.getTime() + 60 * 60 * 1000))[0];

  // Schritt 1
  const [filledById, setFilledById] = useState(initialFilledById);
  const [startDate, setStartDate] = useState(toDateInputValue(now));
  const [startTime, setStartTime] = useState(toTimeInputValue(now));
  const [endDate, setEndDate] = useState(toDateInputValue(oneHourLater));
  const [endTime, setEndTime] = useState(toTimeInputValue(oneHourLater));
  const [ownActivity, setOwnActivity] = useState<boolean | null>(null);
  const [activityKinds, setActivityKinds] = useState<string[]>([]);
  const [activityOther, setActivityOther] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Schritt 2
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleKm, setVehicleKm] = useState('');
  const [reportMembers, setReportMembers] = useState<ReportMemberEntry[]>([
    { userId: initialFilledById, funktion: 'MANNSCHAFT' },
  ]);

  // Schritt 3
  const [quantityValues, setQuantityValues] = useState<Record<string, number>>({});
  const [visibleQuantities, setVisibleQuantities] = useState<Set<string>>(new Set());
  const [showLoescher, setShowLoescher] = useState(false);
  const [remark, setRemark] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinueStep1 = ownActivity !== null && (activityKinds.length > 0 || activityOther.trim().length > 0);

  function goToStep2() {
    if (!canContinueStep1) return;
    setStep(2);
  }
  function goToStep3() {
    setStep(3);
  }
  function goBack() {
    setStep((current) => (current === 3 ? 2 : 1));
  }

  function addMember(ids: string[]) {
    const newId = ids[ids.length - 1];
    setReportMembers((current) => [...current, { userId: newId, funktion: 'MANNSCHAFT' }]);
  }
  function removeMember(userId: string) {
    setReportMembers((current) => current.filter((m) => m.userId !== userId));
  }
  function setMemberFunktion(userId: string, funktion: (typeof FUNKTIONEN)[number]) {
    setReportMembers((current) => current.map((m) => (m.userId === userId ? { ...m, funktion } : m)));
  }

  function setQuantity(kind: 'MATERIAL' | 'EQUIPMENT', code: string, value: number) {
    setQuantityValues((current) => ({ ...current, [`${kind}:${code}`]: value }));
  }
  function revealQuantity(kind: 'MATERIAL' | 'EQUIPMENT', code: string) {
    setVisibleQuantities((current) => new Set(current).add(`${kind}:${code}`));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    const quantities = Object.entries(quantityValues)
      .filter(([key]) => visibleQuantities.has(key))
      .map(([key, value]) => {
        const [kind, code] = key.split(':') as ['MATERIAL' | 'EQUIPMENT', string];
        return { kind, code, value };
      });

    const payload: SubmitReportInput = {
      type,
      filledById,
      startAt: combine(startDate, startTime),
      endAt: combine(endDate, endTime),
      ownActivity: ownActivity!,
      activityKinds,
      activityOther: activityOther.trim() || null,
      vehicleId: vehicleId || null,
      vehicleKm: vehicleId ? (vehicleKm.trim() !== '' && !Number.isNaN(Number(vehicleKm)) ? Math.round(Number(vehicleKm)) : null) : null,
      remark: remark.trim(),
      members: reportMembers,
      quantities,
    };

    try {
      const result = await submitReport(payload);
      if (result.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      router.push(`/meine-feuerwehr/berichte/${result.reportId}/abgeschlossen`);
    } catch {
      setError('Der Bericht konnte nicht abgegeben werden. Bitte erneut versuchen.');
      setSubmitting(false);
    }
  }

  const nonLoescherMaterials = MATERIALS.filter((m) => !LOESCHER_CODES.includes(m.code));
  const loescherMaterials = MATERIALS.filter((m) => LOESCHER_CODES.includes(m.code));

  function renderQuantityRow(kind: 'MATERIAL' | 'EQUIPMENT', option: { code: string; label: string; unit: string }) {
    const key = `${kind}:${option.code}`;
    if (!visibleQuantities.has(key)) {
      return (
        <button
          key={option.code}
          type="button"
          onClick={() => revealQuantity(kind, option.code)}
          className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand"
        >
          + {option.label}
        </button>
      );
    }
    return (
      <div key={option.code} className="flex items-center justify-between gap-2 border-b border-neutral-100 py-2">
        <span className="text-sm text-[#1c1c1e]">
          {option.label}{' '}
          <span className="text-xs text-neutral-400">
            ({option.unit === 'LITER' ? 'Liter' : option.unit === 'SAECKE' ? 'Säcke' : option.unit === 'STUECK' ? 'Stk.' : 'Betriebsstunden'})
          </span>
        </span>
        <input
          type="number"
          inputMode={option.unit === 'LITER' || option.unit === 'BETRIEBSSTUNDEN' ? 'decimal' : 'numeric'}
          step={option.unit === 'LITER' || option.unit === 'BETRIEBSSTUNDEN' ? '0.1' : '1'}
          value={quantityValues[key] ?? ''}
          onChange={(e) => setQuantity(kind, option.code, Number(e.target.value))}
          className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-right text-sm"
        />
      </div>
    );
  }

  const canSubmit = remark.trim().length > 0;

  return (
    <div className="flex flex-col gap-5 pb-48">
      <WizardHeader step={step} onBack={goBack} />

      {step === 1 && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Ausgefüllt von</label>
            <MemberSearchSelect members={members} value={filledById} onChange={setFilledById} placeholder="Mitglied wählen" />
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Zeitraum</label>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eigene Tätigkeit</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOwnActivity(true)}
                className={`h-10 rounded-lg text-sm font-semibold ${ownActivity === true ? 'bg-brand text-white' : 'border border-neutral-300 text-neutral-700'}`}
              >
                Ja
              </button>
              <button
                type="button"
                onClick={() => setOwnActivity(false)}
                className={`h-10 rounded-lg text-sm font-semibold ${ownActivity === false ? 'bg-brand text-white' : 'border border-neutral-300 text-neutral-700'}`}
              >
                Nein
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Tätigkeitsart</label>
            <div className="flex flex-wrap items-center gap-2">
              {activityKinds.map((code) => (
                <span key={code} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
                  {ACTIVITY_KINDS.find((k) => k.code === code)?.label ?? code}
                </span>
              ))}
              {activityOther && <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">Sonstige: {activityOther}</span>}
              {activityKinds.length > 0 || activityOther ? (
                <button type="button" onClick={() => setPickerOpen(true)} className="text-xs font-medium text-brand underline">
                  Ändern
                </button>
              ) : (
                <button type="button" onClick={() => setPickerOpen(true)} className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
                  + Tätigkeitsart wählen
                </button>
              )}
            </div>
          </div>

          {pickerOpen && (
            <ActivityKindPicker
              selected={activityKinds}
              activityOther={activityOther}
              recentActivityKinds={recentActivityKinds}
              onDone={(nextKinds, nextOther) => {
                setActivityKinds(nextKinds);
                setActivityOther(nextOther);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}

          <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
            <button
              type="button"
              onClick={goToStep2}
              disabled={!canContinueStep1}
              className={`flex h-[52px] w-full items-center justify-center rounded-lg text-[15px] font-semibold text-white ${
                canContinueStep1 ? 'bg-brand' : 'pointer-events-none bg-neutral-300'
              }`}
            >
              Weiter
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Fahrzeug</label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">Kein Fahrzeug</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.taktischeBezeichnung} ({vehicle.kennzeichen})
                </option>
              ))}
            </select>
            {vehicleId && (
              <div className="mt-2">
                <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">km</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={vehicleKm}
                  onChange={(e) => setVehicleKm(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eingesetzte Mitglieder</label>
            <div className="flex flex-col gap-2">
              {reportMembers.map((entry) => {
                const member = members.find((m) => m.id === entry.userId);
                return (
                  <div key={entry.userId} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-[#1c1c1e]">
                      {member ? `${member.lastName} ${member.firstName}` : entry.userId}
                    </span>
                    <select
                      value={entry.funktion}
                      onChange={(e) => setMemberFunktion(entry.userId, e.target.value as (typeof FUNKTIONEN)[number])}
                      className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                    >
                      {FUNKTIONEN.map((f) => (
                        <option key={f} value={f}>
                          {FUNKTION_LABEL[f]}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => removeMember(entry.userId)} className="text-red-700">
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-2">
              <MemberMultiSelect
                members={members.filter((m) => !reportMembers.some((entry) => entry.userId === m.id))}
                value={reportMembers.map((entry) => entry.userId)}
                onChange={addMember}
                placeholder="Mitglied hinzufügen"
              />
            </div>
          </div>

          <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
            <button
              type="button"
              onClick={goToStep3}
              className="flex h-[52px] w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white"
            >
              Weiter
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Verbrauchsmaterial</label>
            <div className="flex flex-col gap-1">{nonLoescherMaterials.map((m) => renderQuantityRow('MATERIAL', m))}</div>
            {!showLoescher ? (
              <button type="button" onClick={() => setShowLoescher(true)} className="mt-2 rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
                + Löscher (4)
              </button>
            ) : (
              <div className="mt-2 flex flex-col gap-1">{loescherMaterials.map((m) => renderQuantityRow('MATERIAL', m))}</div>
            )}
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eingesetzte Geräte</label>
            <div className="flex flex-col gap-1">{EQUIPMENT.map((e) => renderQuantityRow('EQUIPMENT', e))}</div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Bemerkung</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              className={`flex h-[52px] w-full items-center justify-center rounded-lg text-[15px] font-semibold text-white ${
                canSubmit && !submitting ? 'bg-brand' : 'bg-neutral-300'
              }`}
            >
              {submitting ? 'Wird abgegeben …' : 'Bericht abgeben'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
