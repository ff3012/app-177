'use client';

import { useState, type ReactNode } from 'react';

/** Bausteine des Checklisten-Wizards: mobile zuerst, Trefferflächen mindestens 44 px. */

export function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-surface p-4 shadow-card">
      {title && <h2 className="text-[15px] font-bold text-ink">{title}</h2>}
      {hint && <p className="mt-0.5 text-[13px] text-ink-muted">{hint}</p>}
      <div className={title || hint ? 'mt-3 flex flex-col gap-3.5' : 'flex flex-col gap-3.5'}>{children}</div>
    </section>
  );
}

export function Field({ label, nr, children, hint }: { label: string; nr?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        {nr && <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">{nr}</span>}
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[16px] text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none disabled:opacity-60';

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'time' | 'tel';
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel';
}) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value ?? ''}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} resize-y`}
    />
  );
}

/** Zahlenfeld mit eigenem Text-Zustand, damit "6," oder "6." beim Tippen nicht sofort umformatiert wird. */
export function NumberInput({ value, onChange, placeholder, unit }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; unit?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','));
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = Number(e.target.value.replace(',', '.'));
          onChange(e.target.value.trim() === '' || Number.isNaN(parsed) ? undefined : parsed);
        }}
        className={inputClass}
      />
      {unit && <span className="text-sm text-ink-muted">{unit}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder }: { value: string | undefined; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">{placeholder ?? '– bitte wählen –'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Große Auswahl-Buttons (aria-pressed), gewählt = schwarz gefüllt. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: { value: T; label: string; sub?: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3 | 4;
}) {
  const cols = columns ?? (options.length <= 2 ? 2 : options.length === 4 ? 4 : options.length === 3 ? 3 : 1);
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[cols];
  return (
    <div className={`grid gap-2 ${grid}`}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-left text-[15px] font-semibold ${
              selected ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'
            }`}
          >
            {o.label}
            {o.sub && <span className={`block text-xs font-normal ${selected ? 'text-white/80' : 'text-ink-muted'}`}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Zeile mit 24-px-Kästchen: abgehakt grün. */
export function CheckRow({ nr, label, checked, onToggle, hint }: { nr?: string; label: string; checked: boolean; onToggle: () => void; hint?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex min-h-11 w-full items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-left"
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold text-white ${
          checked ? 'border-[#1f8a5b] bg-[#1f8a5b]' : 'border-line-strong bg-surface'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1">
        <span className="block text-[15px] text-ink">
          {nr && <span className="mr-2 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">{nr}</span>}
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-xs text-amber-800">{hint}</span>}
      </span>
    </button>
  );
}

export function NowButton({ onClick, label = 'Jetzt' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 shrink-0 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink">
      {label}
    </button>
  );
}

export function InfoBox({ tone, children }: { tone: 'amber' | 'red' | 'green'; children: ReactNode }) {
  const styles = {
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    red: 'border-red-300 bg-red-50 text-red-900',
    green: 'border-green-300 bg-green-50 text-green-900',
  }[tone];
  return <div className={`rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${styles}`}>{children}</div>;
}

export function Chips({ options, selected, onToggle }: { options: { value: string; label: string }[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const isOn = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={isOn}
            onClick={() => onToggle(o.value)}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-semibold ${isOn ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
