'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MemberMultiSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-multi-select';
import { FUNKTION_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import { updateReportDraft, updateReportMembers, type ReportMemberPatchEntry } from '../../actions';

const FUNKTIONEN = ['KOMMANDANT', 'FAHRER', 'MANNSCHAFT'] as const;

export function Schritt2Form({
  reportId,
  fromBooking,
  initialVehicleId,
  initialVehicleKm,
  vehicles,
  members,
  initialMembers,
  filledById,
}: {
  reportId: string;
  fromBooking: boolean;
  initialVehicleId: string | null;
  initialVehicleKm: number | null;
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  members: ReportMemberOption[];
  initialMembers: ReportMemberPatchEntry[];
  filledById: string;
}) {
  const [vehicleId, setVehicleId] = useState<string>(initialVehicleId ?? '');
  const [vehicleKm, setVehicleKm] = useState<string>(initialVehicleKm?.toString() ?? '');
  const [reportMembers, setReportMembers] = useState<ReportMemberPatchEntry[]>(
    initialMembers.length > 0 ? initialMembers : [{ userId: filledById, funktion: 'MANNSCHAFT' }],
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateReportDraft(reportId, {
        vehicleId: vehicleId || null,
        vehicleKm: vehicleId ? Number(vehicleKm) || null : null,
      });
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, vehicleKm]);

  useEffect(() => {
    const timeout = setTimeout(() => updateReportMembers(reportId, reportMembers), 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportMembers]);

  function addMember(ids: string[]) {
    const newId = ids[ids.length - 1];
    setReportMembers((current) => [...current, { userId: newId, funktion: 'MANNSCHAFT' }]);
  }
  function removeMember(userId: string) {
    setReportMembers((current) => current.filter((m) => m.userId !== userId));
  }
  function setFunktion(userId: string, funktion: (typeof FUNKTIONEN)[number]) {
    setReportMembers((current) => current.map((m) => (m.userId === userId ? { ...m, funktion } : m)));
  }

  const canContinue = true;

  return (
    <div className="flex flex-col gap-5 pb-24">
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
        {fromBooking && (
          <p className="mt-2 text-xs text-neutral-400">Aus der Reservierung übernommen, änderbar.</p>
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
                  onChange={(e) => setFunktion(entry.userId, e.target.value as (typeof FUNKTIONEN)[number])}
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
        <Link
          href={canContinue ? `/meine-feuerwehr/berichte/${reportId}/schritt-3` : '#'}
          className="flex h-[52px] w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white"
        >
          Weiter
        </Link>
      </div>
    </div>
  );
}
