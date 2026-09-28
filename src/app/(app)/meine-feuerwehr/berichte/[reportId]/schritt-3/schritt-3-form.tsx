'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MATERIALS, EQUIPMENT, LOESCHER_CODES } from '@/lib/heimatfeuerwehr/report-constants';
import { updateReportDraft, updateReportQuantities, type ReportQuantityPatchEntry } from '../../actions';
import { submitReport } from '../../submit-actions';

function useQuantityMap(initial: ReportQuantityPatchEntry[]) {
  const map: Record<string, number> = {};
  for (const entry of initial) map[`${entry.kind}:${entry.code}`] = entry.value;
  return map;
}

export function Schritt3Form({
  reportId,
  initialRemark,
  initialQuantities,
}: {
  reportId: string;
  initialRemark: string;
  initialQuantities: ReportQuantityPatchEntry[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, number>>(useQuantityMap(initialQuantities));
  const [visible, setVisible] = useState<Set<string>>(new Set(Object.keys(useQuantityMap(initialQuantities))));
  const [showLoescher, setShowLoescher] = useState(LOESCHER_CODES.some((code) => `MATERIAL:${code}` in useQuantityMap(initialQuantities)));
  const [remark, setRemark] = useState(initialRemark);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setValue(kind: 'MATERIAL' | 'EQUIPMENT', code: string, value: number) {
    setValues((current) => ({ ...current, [`${kind}:${code}`]: value }));
  }
  function reveal(kind: 'MATERIAL' | 'EQUIPMENT', code: string) {
    setVisible((current) => new Set(current).add(`${kind}:${code}`));
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const quantities: ReportQuantityPatchEntry[] = Object.entries(values)
        .filter(([key]) => visible.has(key))
        .map(([key, value]) => {
          const [kind, code] = key.split(':') as ['MATERIAL' | 'EQUIPMENT', string];
          return { kind, code, value };
        });
      updateReportQuantities(reportId, quantities);
      updateReportDraft(reportId, { remark });
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, visible, remark]);

  const nonLoescherMaterials = MATERIALS.filter((m) => !LOESCHER_CODES.includes(m.code));
  const loescherMaterials = MATERIALS.filter((m) => LOESCHER_CODES.includes(m.code));

  function renderRow(kind: 'MATERIAL' | 'EQUIPMENT', option: { code: string; label: string; unit: string }) {
    const key = `${kind}:${option.code}`;
    if (!visible.has(key)) {
      return (
        <button
          key={option.code}
          type="button"
          onClick={() => reveal(kind, option.code)}
          className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand"
        >
          + {option.label}
        </button>
      );
    }
    return (
      <div key={option.code} className="flex items-center justify-between gap-2 border-b border-neutral-100 py-2">
        <span className="text-sm text-[#1c1c1e]">
          {option.label} <span className="text-xs text-neutral-400">({option.unit === 'LITER' ? 'Liter' : option.unit === 'SAECKE' ? 'Säcke' : option.unit === 'STUECK' ? 'Stk.' : 'Betriebsstunden'})</span>
        </span>
        <input
          type="number"
          inputMode={option.unit === 'LITER' || option.unit === 'BETRIEBSSTUNDEN' ? 'decimal' : 'numeric'}
          step={option.unit === 'LITER' || option.unit === 'BETRIEBSSTUNDEN' ? '0.1' : '1'}
          value={values[key] ?? ''}
          onChange={(e) => setValue(kind, option.code, Number(e.target.value))}
          className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-right text-sm"
        />
      </div>
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const result = await submitReport(reportId);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
    } else {
      router.push(`/meine-feuerwehr/berichte/${reportId}/abgeschlossen`);
    }
  }

  const canSubmit = remark.trim().length > 0;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Verbrauchsmaterial</label>
        <div className="flex flex-col gap-1">{nonLoescherMaterials.map((m) => renderRow('MATERIAL', m))}</div>
        {!showLoescher ? (
          <button type="button" onClick={() => setShowLoescher(true)} className="mt-2 rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
            + Löscher (4)
          </button>
        ) : (
          <div className="mt-2 flex flex-col gap-1">{loescherMaterials.map((m) => renderRow('MATERIAL', m))}</div>
        )}
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eingesetzte Geräte</label>
        <div className="flex flex-col gap-1">{EQUIPMENT.map((e) => renderRow('EQUIPMENT', e))}</div>
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
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
    </div>
  );
}
