'use client';

import { useActionState } from 'react';
import { DEVICE_NAME_MAX } from '@/lib/heimatfeuerwehr/report-kiosk-device-name';
import { setReportKioskDeviceName, type DeviceNameState } from './report-kiosk-actions';

const initialState: DeviceNameState = {};

/** Gerätename des iPads (erscheint im Kopf der Schnellerfassung). Leer = kein Name. */
export function ReportKioskDeviceNameForm({ organizationId, initialName }: { organizationId: string; initialName: string | null }) {
  const [state, formAction, pending] = useActionState(setReportKioskDeviceName.bind(null, organizationId), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <label htmlFor="reportKioskDeviceName" className="text-[13px] font-medium text-ink">
          Gerätename
        </label>
        <input
          id="reportKioskDeviceName"
          name="deviceName"
          type="text"
          defaultValue={initialName ?? ''}
          maxLength={DEVICE_NAME_MAX}
          placeholder="z. B. Tablet Feuerwehr EG"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
          state.success ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
        }`}
      >
        {pending ? 'Speichern…' : state.success ? 'Gespeichert' : 'Speichern'}
      </button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
