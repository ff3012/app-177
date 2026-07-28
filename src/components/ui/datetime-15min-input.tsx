'use client';

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const hours = String(Math.floor(i / 4)).padStart(2, '0');
  const minutes = String((i % 4) * 15).padStart(2, '0');
  return `${hours}:${minutes}`;
});

interface DateTime15MinInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

/**
 * Ersetzt <input type="datetime-local"> für Felder, die nur 15-Minuten-Schritte erlauben
 * sollen: das "step"-Attribut auf datetime-local schränkt bei Chrome/Edge nur die Validität
 * ein, nicht die angezeigte Minutenliste im nativen Picker (der zeigt weiterhin jede Minute
 * einzeln an) — daher hier ein echtes Datum-Feld + ein <select> mit ausschließlich
 * 00/15/30/45 als Optionen, sodass Einzelminuten gar nicht auswählbar sind.
 */
export function DateTime15MinInput({ value, onChange, onBlur }: DateTime15MinInputProps) {
  const [datePart = '', timePart = ''] = value ? value.split('T') : [];

  return (
    <div className="flex gap-2">
      <input
        type="date"
        required
        value={datePart}
        onChange={(event) => onChange(`${event.target.value}T${timePart}`)}
        onBlur={onBlur}
        className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-2"
      />
      <select
        required
        value={timePart}
        onChange={(event) => onChange(`${datePart}T${event.target.value}`)}
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
    </div>
  );
}
