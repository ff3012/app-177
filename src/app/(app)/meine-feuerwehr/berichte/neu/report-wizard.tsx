'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MemberSearchSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-search-select';
import { MemberMultiSelect } from '@/components/heimatfeuerwehr/member-multi-select';
import {
  MATERIALS,
  EQUIPMENT,
  LOESCHER_CODES,
  FUNKTION_LABEL,
  getKindOptionsForType,
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

function WizardHeader({ step, totalSteps, onBack }: { step: number; totalSteps: number; onBack: () => void }) {
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
        <span className="text-xs font-medium text-neutral-500">
          Schritt {step} von {totalSteps}
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-brand' : 'bg-neutral-200'}`} />
        ))}
      </div>
    </div>
  );
}

interface ReportMemberEntry {
  userId: string;
  funktion: (typeof FUNKTIONEN)[number];
  /** null = "ohne Fahrzeug" (z. B. zu Fuß/privat angereist) - sonst die vehicleId eines der unten in
   * `vehicleEntries` ausgewählten Fahrzeuge. */
  vehicleId: string | null;
}

interface ReportVehicleEntry {
  vehicleId: string;
  km: string;
}

function MemberRow({
  entry,
  members,
  onFunktionChange,
  onRemove,
}: {
  entry: ReportMemberEntry;
  members: ReportMemberOption[];
  onFunktionChange: (userId: string, funktion: (typeof FUNKTIONEN)[number]) => void;
  onRemove: (userId: string) => void;
}) {
  const member = members.find((m) => m.id === entry.userId);
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm text-[#1c1c1e]">{member ? `${member.lastName} ${member.firstName}` : entry.userId}</span>
      <select
        value={entry.funktion}
        onChange={(e) => onFunktionChange(entry.userId, e.target.value as (typeof FUNKTIONEN)[number])}
        className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
      >
        {FUNKTIONEN.map((f) => (
          <option key={f} value={f}>
            {FUNKTION_LABEL[f]}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => onRemove(entry.userId)} className="text-red-700">
        ×
      </button>
    </div>
  );
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
  prefillVehicleId,
  prefillStartAt,
  prefillEndAt,
}: {
  type: ReportType;
  filledById: string;
  members: ReportMemberOption[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentActivityKinds: string[];
  /** Vorbefüllung aus einer "Zu erledigen"-Fahrzeug-Erinnerung (vehicle-report-reminder-card.tsx) -
   * alle drei optional/null, wenn der Assistent ganz normal über "Neuer Bericht" gestartet wurde. */
  prefillVehicleId?: string | null;
  prefillStartAt?: string | null;
  prefillEndAt?: string | null;
}) {
  const router = useRouter();
  const isExercise = type === 'EXERCISE';
  // Zusätzlicher Übungsdetails-Schritt nur für Übungsberichte, direkt nach den Grunddaten - Fahrzeuge/
  // Mitglieder und der Abschluss-Schritt rücken dadurch bei einem Übungsbericht je eine Position nach
  // hinten, sonst identisch zum Tätigkeitsbericht-Ablauf.
  const totalSteps = isExercise ? 4 : 3;
  const stepFahrzeuge = isExercise ? 3 : 2;
  const stepAbschluss = isExercise ? 4 : 3;
  const [step, setStep] = useState(1);

  const now = useState(() => new Date())[0];
  const oneHourLater = useState(() => new Date(now.getTime() + 60 * 60 * 1000))[0];
  const initialStart = prefillStartAt ? new Date(prefillStartAt) : now;
  const initialEnd = prefillEndAt ? new Date(prefillEndAt) : oneHourLater;

  // Schritt 1
  const [filledById, setFilledById] = useState(initialFilledById);
  const [startDate, setStartDate] = useState(toDateInputValue(initialStart));
  const [startTime, setStartTime] = useState(toTimeInputValue(initialStart));
  const [endDate, setEndDate] = useState(toDateInputValue(initialEnd));
  const [endTime, setEndTime] = useState(toTimeInputValue(initialEnd));
  const [ownActivity, setOwnActivity] = useState<boolean | null>(null);
  const [activityKinds, setActivityKinds] = useState<string[]>([]);
  const [activityOther, setActivityOther] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Übungsdetails (nur Übungsbericht) - wortgetreu aus der offiziellen Papiervorlage
  // (Übungsbericht_045_20260603.docx), siehe Report-Modell-Kommentar in schema.prisma.
  const [uebungsleiterId, setUebungsleiterId] = useState('');
  const [uebungsueberwachungId, setUebungsueberwachungId] = useState('');
  const [uebungsbeobachterId, setUebungsbeobachterId] = useState('');
  const [uebungsortStrasse, setUebungsortStrasse] = useState('');
  const [uebungsortNr, setUebungsortNr] = useState('');
  const [uebungsortPlz, setUebungsortPlz] = useState('');
  const [uebungsortOrt, setUebungsortOrt] = useState('');
  const [weitereFeuerwehren, setWeitereFeuerwehren] = useState('');
  const [uebungsziel, setUebungsziel] = useState('');
  const [uebungslage, setUebungslage] = useState('');
  const [uebungsdarstellung, setUebungsdarstellung] = useState('');
  const [fuerUebungVerstaendigen, setFuerUebungVerstaendigen] = useState('');
  const [uebungserkenntnis, setUebungserkenntnis] = useState('');
  const [uebungszielsetzung, setUebungszielsetzung] = useState('');
  const [vorschlaege, setVorschlaege] = useState('');

  // Fahrzeuge/Mitglieder
  const [vehicleEntries, setVehicleEntries] = useState<ReportVehicleEntry[]>(
    prefillVehicleId ? [{ vehicleId: prefillVehicleId, km: '' }] : [],
  );
  const [reportMembers, setReportMembers] = useState<ReportMemberEntry[]>([
    { userId: initialFilledById, funktion: 'MANNSCHAFT', vehicleId: null },
  ]);

  // Abschluss
  const [quantityValues, setQuantityValues] = useState<Record<string, number>>({});
  const [visibleQuantities, setVisibleQuantities] = useState<Set<string>>(new Set());
  const [showLoescher, setShowLoescher] = useState(false);
  const [remark, setRemark] = useState('');
  // Erst nach Verlassen des Felds ODER einem gescheiterten Abgabeversuch markiert - nicht schon beim
  // ersten Laden der Seite, das würde ein leeres Pflichtfeld zeigen, bevor der Nutzer überhaupt die
  // Chance hatte, es auszufüllen.
  const [remarkTouched, setRemarkTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinueStep1 = ownActivity !== null && (activityKinds.length > 0 || activityOther.trim().length > 0);

  function goToStep1Next() {
    if (!canContinueStep1) return;
    setStep((current) => current + 1);
  }
  function goToNextStep() {
    setStep((current) => Math.min(current + 1, totalSteps));
  }
  function goBack() {
    setStep((current) => Math.max(current - 1, 1));
  }

  function addVehicle(vehicleId: string) {
    setVehicleEntries((current) => [...current, { vehicleId, km: '' }]);
  }
  function removeVehicle(vehicleId: string) {
    setVehicleEntries((current) => current.filter((v) => v.vehicleId !== vehicleId));
    // Mitglieder dieses Fahrzeugs wandern zurück in "Ohne Fahrzeug", statt zu verschwinden - das
    // Entfernen eines Fahrzeugs ist eine Korrektur der Auswahl, keine Aussage "diese Mitglieder waren
    // nicht dabei".
    setReportMembers((current) => current.map((m) => (m.vehicleId === vehicleId ? { ...m, vehicleId: null } : m)));
  }
  function setVehicleKm(vehicleId: string, km: string) {
    setVehicleEntries((current) => current.map((v) => (v.vehicleId === vehicleId ? { ...v, km } : v)));
  }

  function addMembers(vehicleId: string | null, ids: string[]) {
    setReportMembers((current) => [...current, ...ids.map((userId) => ({ userId, funktion: 'MANNSCHAFT' as const, vehicleId }))]);
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
    if (remark.trim().length === 0) {
      setRemarkTouched(true);
      return;
    }
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
      vehicles: vehicleEntries.map((v) => ({
        vehicleId: v.vehicleId,
        km: v.km.trim() !== '' && !Number.isNaN(Number(v.km)) ? Math.round(Number(v.km)) : 0,
      })),
      remark: remark.trim(),
      members: reportMembers,
      quantities,
      uebungsleiterId: uebungsleiterId || null,
      uebungsueberwachungId: uebungsueberwachungId || null,
      uebungsbeobachterId: uebungsbeobachterId || null,
      uebungsortStrasse: uebungsortStrasse.trim() || null,
      uebungsortNr: uebungsortNr.trim() || null,
      uebungsortPlz: uebungsortPlz.trim() || null,
      uebungsortOrt: uebungsortOrt.trim() || null,
      weitereFeuerwehren: weitereFeuerwehren.trim() || null,
      uebungsziel: uebungsziel.trim() || null,
      uebungslage: uebungslage.trim() || null,
      uebungsdarstellung: uebungsdarstellung.trim() || null,
      fuerUebungVerstaendigen: fuerUebungVerstaendigen.trim() || null,
      uebungserkenntnis: uebungserkenntnis.trim() || null,
      uebungszielsetzung: uebungszielsetzung.trim() || null,
      vorschlaege: vorschlaege.trim() || null,
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

  const kindOptions = getKindOptionsForType(type);
  const kindTitle = isExercise ? 'Übungsart' : 'Tätigkeitsart';
  const kindListLabel = isExercise ? 'Alle Übungsarten' : 'Alle Tätigkeitsarten';

  return (
    <div className="flex flex-col gap-5 pb-48">
      <WizardHeader step={step} totalSteps={totalSteps} onBack={goBack} />

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
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">
              {isExercise ? 'Eigener Einsatzbereich' : 'Eigene Tätigkeit'}
            </label>
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
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">{kindTitle}</label>
            <div className="flex flex-wrap items-center gap-2">
              {activityKinds.map((code) => (
                <span key={code} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
                  {kindOptions.find((k) => k.code === code)?.label ?? code}
                </span>
              ))}
              {activityOther && <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">Sonstige: {activityOther}</span>}
              {activityKinds.length > 0 || activityOther ? (
                <button type="button" onClick={() => setPickerOpen(true)} className="text-xs font-medium text-brand underline">
                  Ändern
                </button>
              ) : (
                <button type="button" onClick={() => setPickerOpen(true)} className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
                  + {kindTitle} wählen
                </button>
              )}
            </div>
          </div>

          {pickerOpen && (
            <ActivityKindPicker
              title={kindTitle}
              listLabel={kindListLabel}
              options={kindOptions}
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
              onClick={goToStep1Next}
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

      {isExercise && step === 2 && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Übungsleiter</label>
            <MemberSearchSelect members={members} value={uebungsleiterId} onChange={setUebungsleiterId} placeholder="Mitglied wählen" />
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Übungsüberwachung</label>
            <MemberSearchSelect members={members} value={uebungsueberwachungId} onChange={setUebungsueberwachungId} placeholder="Mitglied wählen" />
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Übungsbeobachter</label>
            <MemberSearchSelect members={members} value={uebungsbeobachterId} onChange={setUebungsbeobachterId} placeholder="Mitglied wählen" />
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Übungsort</label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Straße"
                value={uebungsortStrasse}
                onChange={(e) => setUebungsortStrasse(e.target.value)}
                className="col-span-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Nr./km"
                value={uebungsortNr}
                onChange={(e) => setUebungsortNr(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="PLZ"
                value={uebungsortPlz}
                onChange={(e) => setUebungsortPlz(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Ort"
                value={uebungsortOrt}
                onChange={(e) => setUebungsortOrt(e.target.value)}
                className="col-span-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Weitere Feuerwehren</label>
            <input
              type="text"
              value={weitereFeuerwehren}
              onChange={(e) => setWeitereFeuerwehren(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
            <button
              type="button"
              onClick={goToNextStep}
              className="flex h-[52px] w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white"
            >
              Weiter
            </button>
          </div>
        </>
      )}

      {step === stepFahrzeuge && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Fahrzeuge</label>
            <div className="flex flex-col gap-3">
              {vehicleEntries.map((entry) => {
                const vehicle = vehicles.find((v) => v.id === entry.vehicleId);
                const vehicleMembers = reportMembers.filter((m) => m.vehicleId === entry.vehicleId);
                return (
                  <div key={entry.vehicleId} className="rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[#1c1c1e]">
                        {vehicle ? `${vehicle.taktischeBezeichnung} (${vehicle.kennzeichen})` : entry.vehicleId}
                      </span>
                      <button type="button" onClick={() => removeVehicle(entry.vehicleId)} className="text-red-700">
                        ×
                      </button>
                    </div>
                    <div className="mt-2">
                      <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">km</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={entry.km}
                        onChange={(e) => setVehicleKm(entry.vehicleId, e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      {vehicleMembers.map((memberEntry) => (
                        <MemberRow key={memberEntry.userId} entry={memberEntry} members={members} onFunktionChange={setMemberFunktion} onRemove={removeMember} />
                      ))}
                    </div>
                    <div className="mt-2">
                      <MemberMultiSelect
                        members={members}
                        excludeIds={reportMembers.map((m) => m.userId)}
                        onAdd={(ids) => addMembers(entry.vehicleId, ids)}
                        placeholder="Mitglied hinzufügen"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3">
              <select
                key={vehicleEntries.length}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) addVehicle(e.target.value);
                }}
                className="w-full rounded-lg border border-dashed border-brand px-3 py-2 text-sm font-medium text-brand"
              >
                <option value="">+ Fahrzeug hinzufügen</option>
                {vehicles
                  .filter((v) => !vehicleEntries.some((entry) => entry.vehicleId === v.id))
                  .map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.taktischeBezeichnung} ({vehicle.kennzeichen})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Ohne Fahrzeug</label>
            <div className="flex flex-col gap-2">
              {reportMembers
                .filter((entry) => entry.vehicleId === null)
                .map((entry) => (
                  <MemberRow key={entry.userId} entry={entry} members={members} onFunktionChange={setMemberFunktion} onRemove={removeMember} />
                ))}
            </div>
            <div className="mt-2">
              <MemberMultiSelect
                members={members}
                excludeIds={reportMembers.map((entry) => entry.userId)}
                onAdd={(ids) => addMembers(null, ids)}
                placeholder="Mitglied hinzufügen"
              />
            </div>
          </div>

          <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
            <button
              type="button"
              onClick={goToNextStep}
              className="flex h-[52px] w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white"
            >
              Weiter
            </button>
          </div>
        </>
      )}

      {step === stepAbschluss && (
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

          {isExercise && (
            <>
              {(
                [
                  ['Übungsziel', uebungsziel, setUebungsziel],
                  ['Übungslage', uebungslage, setUebungslage],
                  ['Übungsdarstellung', uebungsdarstellung, setUebungsdarstellung],
                  ['Für Übung verständigen', fuerUebungVerstaendigen, setFuerUebungVerstaendigen],
                  ['Übungserkenntnis', uebungserkenntnis, setUebungserkenntnis],
                  ['Übungszielsetzung', uebungszielsetzung, setUebungszielsetzung],
                  ['Vorschläge', vorschlaege, setVorschlaege],
                ] as const
              ).map(([label, value, setValue]) => (
                <div key={label} className="rounded-xl bg-white p-4 shadow-sm">
                  <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">{label}</label>
                  <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </>
          )}

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">
              Bemerkung <span className="text-red-600">*</span>
            </label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              onBlur={() => setRemarkTouched(true)}
              rows={4}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                remarkTouched && remark.trim().length === 0 ? 'border-red-500 bg-red-50' : 'border-neutral-300'
              }`}
            />
            {remarkTouched && remark.trim().length === 0 && (
              <p className="mt-1 text-xs text-red-600">Bemerkung ist erforderlich.</p>
            )}
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
            <button
              type="button"
              disabled={submitting}
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
