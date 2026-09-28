'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MemberSearchSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-search-select';
import { ACTIVITY_KINDS } from '@/lib/heimatfeuerwehr/report-constants';
import { ActivityKindPicker } from './activity-kind-picker';
import { updateReportDraft } from '../../actions';

interface Schritt1ReportData {
  id: string;
  filledById: string;
  startAt: string;
  endAt: string;
  ownActivity: boolean | null;
  activityKinds: string[];
  activityOther: string | null;
}

// Datum UND Uhrzeit müssen aus demselben Bezugsrahmen (lokale Zeit) kommen - ein rohes
// iso.slice(0, 10) wäre das UTC-Datum und würde für Zeiten zwischen ca. 00:00-02:00 Wiener Zeit den
// Vortag anzeigen, während toTimeInputValue die lokale Uhrzeit zeigt; combine() würde daraus dann einen
// um einen ganzen Tag verschobenen Zeitpunkt zurückschreiben.
function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function toTimeInputValue(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 5);
}
function combine(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function Schritt1Form({
  report,
  members,
  recentActivityKinds,
  vehicleBooking,
}: {
  report: Schritt1ReportData;
  members: ReportMemberOption[];
  recentActivityKinds: string[];
  vehicleBooking: { startsAt: string; endsAt: string } | null;
}) {
  const [filledById, setFilledById] = useState(report.filledById);
  const [startDate, setStartDate] = useState(toDateInputValue(report.startAt));
  const [startTime, setStartTime] = useState(toTimeInputValue(report.startAt));
  const [endDate, setEndDate] = useState(toDateInputValue(report.endAt));
  const [endTime, setEndTime] = useState(toTimeInputValue(report.endAt));
  const [ownActivity, setOwnActivity] = useState<boolean | null>(report.ownActivity);
  const [activityKinds, setActivityKinds] = useState<string[]>(report.activityKinds);
  const [activityOther, setActivityOther] = useState(report.activityOther ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  async function saveNow(): Promise<{ error?: string }> {
    setSaving(true);
    try {
      const result = await updateReportDraft(report.id, {
        filledById,
        startAt: combine(startDate, startTime),
        endAt: combine(endDate, endTime),
        ownActivity: ownActivity ?? undefined,
        activityKinds,
        activityOther: activityOther || null,
      });
      setError(result.error ?? null);
      return result;
    } catch {
      const message = 'Speichern fehlgeschlagen. Bitte erneut versuchen.';
      setError(message);
      return { error: message };
    } finally {
      setSaving(false);
    }
  }

  function scheduleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void saveNow();
    }, 500);
  }

  // "Weiter" darf nicht einfach navigieren, solange noch ein entprellter Speichervorgang aussteht - eine
  // Änderung innerhalb der letzten ~500 ms ginge sonst verloren. Daher: ausstehenden Timer verwerfen, mit
  // den aktuellen Werten sofort speichern (und abwarten), erst dann weiter. Bei einem Validierungsfehler
  // (z. B. Ende vor Beginn) bleibt der Benutzer auf diesem Schritt und sieht die Meldung.
  async function handleContinue() {
    if (!canContinue || continuing) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setContinuing(true);
    const result = await saveNow();
    if (result.error) {
      setContinuing(false);
      return;
    }
    router.push(`/meine-feuerwehr/berichte/${report.id}/schritt-2`);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scheduleSave, [filledById, startDate, startTime, endDate, endTime, ownActivity, activityKinds, activityOther]);

  const deviatesFromBooking =
    vehicleBooking !== null &&
    (combine(startDate, startTime) !== new Date(vehicleBooking.startsAt).toISOString() ||
      combine(endDate, endTime) !== new Date(vehicleBooking.endsAt).toISOString());

  function resetToBooking() {
    if (!vehicleBooking) return;
    setStartDate(toDateInputValue(vehicleBooking.startsAt));
    setStartTime(toTimeInputValue(vehicleBooking.startsAt));
    setEndDate(toDateInputValue(vehicleBooking.endsAt));
    setEndTime(toTimeInputValue(vehicleBooking.endsAt));
  }

  const canContinue = ownActivity !== null && (activityKinds.length > 0 || activityOther.trim().length > 0);

  return (
    <div className="flex flex-col gap-5 pb-48">
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
        {deviatesFromBooking && (
          <p className="mt-2 flex items-center gap-2 text-xs text-amber-700">
            Reservierung: {toTimeInputValue(vehicleBooking!.startsAt)}–{toTimeInputValue(vehicleBooking!.endsAt)}
            <button type="button" onClick={resetToBooking} className="font-medium underline">
              Zurücksetzen
            </button>
          </p>
        )}
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
        <div className="flex flex-wrap gap-2">
          {activityKinds.map((code) => (
            <span key={code} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              {ACTIVITY_KINDS.find((k) => k.code === code)?.label ?? code}
            </span>
          ))}
          {activityOther && <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">Sonstige: {activityOther}</span>}
          <button type="button" onClick={() => setPickerOpen(true)} className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
            + Tätigkeitsart wählen
          </button>
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

      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-neutral-400">{saving ? 'Speichert …' : 'Gespeichert'}</p>

      {/* bottom-[98px]/z-40: die permanente mobile Tab-Leiste (MobileTabBar) ist ebenfalls
          fixed bottom-0 z-30 - bei gleichem z-index gewinnt sie das Zeichnen (später im DOM) und
          verdeckt diese Leiste vollständig (realer Nutzerbericht: "Weiter" nicht sichtbar). Exakt
          dasselbe Muster wie photo-upload-form.tsx's eigener fixer Button löst das bereits: über der
          Tab-Leiste positionieren, höherer z-index. sm:bottom-0, da die Tab-Leiste ab sm: (640px)
          ohnehin sm:hidden ist. */}
      <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || continuing}
          aria-disabled={!canContinue || continuing}
          className={`flex h-[52px] w-full items-center justify-center rounded-lg text-[15px] font-semibold text-white ${
            canContinue && !continuing ? 'bg-brand' : 'pointer-events-none bg-neutral-300'
          }`}
        >
          Weiter
        </button>
      </div>
    </div>
  );
}
