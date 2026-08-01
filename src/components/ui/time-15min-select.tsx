'use client';

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const hours = String(Math.floor(i / 4)).padStart(2, '0');
  const minutes = String((i % 4) * 15).padStart(2, '0');
  return `${hours}:${minutes}`;
});

interface Time15MinSelectProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  label?: string;
}

/**
 * Reine Zeit-Auswahl in 15-Minuten-Schritten (00/15/30/45), ohne eigenes Datumsfeld - anders als
 * DateTime15MinInput (das Datum+Zeit zu einem Wert bündelt), gedacht für Formulare, in denen ein
 * gemeinsames Datum von zwei Zeit-Feldern geteilt wird (z. B. Start-/Ende-Uhrzeit einer
 * Fahrzeug-Buchung). Dieselbe TIME_OPTIONS-Logik wie DateTime15MinInput, hier als eigene
 * Komponente extrahiert statt dupliziert.
 */
export function Time15MinSelect({ value, onChange, onBlur, label }: Time15MinSelectProps) {
  return (
    <select
      required
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className="rounded border border-neutral-300 px-3 py-2"
    >
      <option value="" disabled>
        Uhrzeit
      </option>
      {TIME_OPTIONS.map((time) => (
        <option key={time} value={time}>
          {time}
        </option>
      ))}
    </select>
  );
}
