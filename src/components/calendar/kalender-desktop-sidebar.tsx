import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { CalendarLayer, StatusFilter } from './kalender-with-layers';

interface KalenderDesktopSidebarProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  openCount: number;
}

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: (openCount: number) => string }[] = [
  { value: 'ALLE', label: () => 'Alle' },
  { value: 'OFFEN', label: (openCount) => `Offen ${openCount}` },
  { value: 'ZUGESAGT', label: () => 'Zugesagt' },
];

/**
 * Desktop-Sidebar (Kalender Browser.dc.html, nur ab lg:) - bewusst eine EIGENE Komponente statt
 * einer Erweiterung von KalenderFiltersContent (die weiterhin unverändert für die mobile
 * BottomSheet zuständig bleibt): die Ebenen-Legende entfällt hier zugunsten einer Fußzeile in der
 * Ebenen-Karte, und die "Nur anzeigen"-Filterkarte mit eigener Rückmeldungen-Farblegende existiert
 * nur auf Desktop-Breite. Ein gemeinsames KalenderFiltersContent mit Bedingungen für all das wäre
 * am Ende nur eine Ansammlung von if/else-Zweigen für zwei tatsächlich unterschiedliche Layouts -
 * dieselbe bewusste Trennung wie AdminSidebarNav/AdminMobileTabs in der Verwaltung.
 */
export function KalenderDesktopSidebar({
  layers,
  enabled,
  onToggle,
  showDrone,
  statusFilter,
  onStatusFilterChange,
  openCount,
}: KalenderDesktopSidebarProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      {layers.length > 1 && (
        <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ebenen</span>
          {layers.map((layer) => (
            <ToggleSwitch
              key={layer.key}
              label={layer.label}
              checked={enabled[layer.key] ?? true}
              onChange={(checked) => onToggle(layer.key, checked)}
            />
          ))}
          {showDrone && (
            <p className="text-xs text-neutral-400">
              Termine der Kategorie Drohnengruppe sind nur für Mitglieder der Drohnengruppe sichtbar.
            </p>
          )}
          <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
            Die Farbe links am Termin zeigt die Ebene. Drohnengruppen-Termine sehen nur deren Mitglieder.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Nur anzeigen</span>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onStatusFilterChange(option.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                statusFilter === option.value
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {option.label(openCount)}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Rückmeldungen</span>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="h-3.5 w-6 shrink-0 rounded" style={{ backgroundColor: '#eaf6f0' }} />
            Zugesagt
          </span>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="h-3.5 w-6 shrink-0 rounded" style={{ backgroundColor: '#fdeeed' }} />
            Abgesagt
          </span>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="h-3.5 w-6 shrink-0 rounded" style={{ backgroundColor: '#f2f2f4' }} />
            Offen
          </span>
        </div>
      </div>
    </div>
  );
}
