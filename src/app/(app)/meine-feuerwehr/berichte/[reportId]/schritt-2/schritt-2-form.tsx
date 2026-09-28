'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MemberMultiSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-multi-select';
import { FUNKTION_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import { updateReportDraft, updateReportMembers, type ReportMemberPatchEntry } from '../../actions';

const FUNKTIONEN = ['KOMMANDANT', 'FAHRER', 'MANNSCHAFT'] as const;
const SAVE_FAILED = 'Speichern fehlgeschlagen. Bitte erneut versuchen.';

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
  const [continuing, setContinuing] = useState(false);
  // Getrennte Fehlerzustände: sonst würde ein erfolgreicher Fahrzeug-Speichervorgang die Fehlermeldung
  // eines fehlgeschlagenen Mitglieder-Speichervorgangs (oder umgekehrt) stillschweigend überschreiben.
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const router = useRouter();
  const vehicleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const membersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ein tatsächlich eingegebenes "0" ist ein gültiger Wert (nicht null), und Report.vehicleKm ist eine
  // Int-Spalte - Dezimalzahlen würden sonst erst beim Prisma-Schreibzugriff als unbehandelter Fehler
  // scheitern, daher hier gerundet.
  function buildVehiclePatch() {
    const trimmedKm = vehicleKm.trim();
    return {
      vehicleId: vehicleId || null,
      vehicleKm: vehicleId
        ? trimmedKm !== '' && !Number.isNaN(Number(trimmedKm))
          ? Math.round(Number(trimmedKm))
          : null
        : null,
    };
  }

  useEffect(() => {
    if (vehicleDebounceRef.current) clearTimeout(vehicleDebounceRef.current);
    vehicleDebounceRef.current = setTimeout(() => {
      vehicleDebounceRef.current = null;
      updateReportDraft(reportId, buildVehiclePatch()).then(
        (result) => setVehicleError(result.error ?? null),
        () => setVehicleError(SAVE_FAILED),
      );
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, vehicleKm]);

  useEffect(() => {
    if (membersDebounceRef.current) clearTimeout(membersDebounceRef.current);
    membersDebounceRef.current = setTimeout(() => {
      membersDebounceRef.current = null;
      updateReportMembers(reportId, reportMembers).then(
        (result) => setMembersError(result.error ?? null),
        () => setMembersError(SAVE_FAILED),
      );
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportMembers]);

  // Beide entprellten Speichervorgänge (Fahrzeug + Mitglieder) verwerfen und mit den aktuellen Werten
  // sofort abwarten, bevor navigiert wird - sonst ginge eine Änderung der letzten ~500 ms verloren.
  async function handleContinue() {
    if (continuing) return;
    if (vehicleDebounceRef.current) {
      clearTimeout(vehicleDebounceRef.current);
      vehicleDebounceRef.current = null;
    }
    if (membersDebounceRef.current) {
      clearTimeout(membersDebounceRef.current);
      membersDebounceRef.current = null;
    }
    setContinuing(true);
    const [vehicleResult, membersResult] = await Promise.all([
      updateReportDraft(reportId, buildVehiclePatch()).catch((): { error?: string } => ({ error: SAVE_FAILED })),
      updateReportMembers(reportId, reportMembers).catch((): { error?: string } => ({ error: SAVE_FAILED })),
    ]);
    setVehicleError(vehicleResult.error ?? null);
    setMembersError(membersResult.error ?? null);
    if (vehicleResult.error || membersResult.error) {
      setContinuing(false);
      return;
    }
    router.push(`/meine-feuerwehr/berichte/${reportId}/schritt-3`);
  }

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
    <div className="flex flex-col gap-5 pb-48">
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

      {vehicleError && <p className="text-sm text-red-700">{vehicleError}</p>}
      {membersError && <p className="text-sm text-red-700">{membersError}</p>}

      {/* bottom-[98px]/z-40: gleicher Fix wie in schritt-1-form.tsx - vermeidet die Kollision mit
          der permanenten mobilen Tab-Leiste (ebenfalls fixed bottom-0 z-30), die diese Leiste sonst
          vollständig verdeckt. */}
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
