'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
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
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const result = await updateReportDraft(report.id, {
        filledById,
        startAt: combine(startDate, startTime),
        endAt: combine(endDate, endTime),
        ownActivity: ownActivity ?? undefined,
        activityKinds,
        activityOther: activityOther || null,
      });
      setSaving(false);
      setError(result.error ?? null);
    }, 500);
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
    <div className="flex flex-col gap-5 pb-24">
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
        <Link
          href={canContinue ? `/meine-feuerwehr/berichte/${report.id}/schritt-2` : '#'}
          aria-disabled={!canContinue}
          className={`flex h-[52px] w-full items-center justify-center rounded-lg text-[15px] font-semibold text-white ${
            canContinue ? 'bg-brand' : 'pointer-events-none bg-neutral-300'
          }`}
        >
          Weiter
        </Link>
      </div>
    </div>
  );
}
