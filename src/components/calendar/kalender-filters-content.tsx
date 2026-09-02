import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { LayerLegend } from './layer-legend';
import type { CalendarLayer, SondergruppeOption } from './kalender-with-layers';

interface KalenderFiltersContentProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  sondergruppen: SondergruppeOption[];
  hiddenSondergruppen: Set<string>;
  onSondergruppeToggle: (sondergruppeId: string, visible: boolean) => void;
}

/**
 * Ebenen-Toggles + Legende - seit der Kalender-Desktop-Browser-Ansicht (Task 2,
 * `kalender-desktop-sidebar.tsx`) NUR NOCH für das mobile Bottom-Sheet (Mobile-Brief.md) zuständig -
 * die `lg:`-Sidebar hat eine eigene Komponente (`KalenderDesktopSidebar`), da ihr Inhalt (keine
 * Legende-Karte, dafür eine neue "Nur anzeigen"-Statusfilter-Karte) genuin abweicht. Diese Komponente
 * hat aktuell genau eine Einbindestelle - innerhalb des `BottomSheet` in `kalender-with-layers.tsx` -
 * und wird im Tablet-Breitenbereich (640-1023px) nirgends im Seitenfluss gerendert (der Desktop-
 * Sidebar-Wrapper ist `hidden lg:flex`, wodurch zwischen 640px und 1024px aktuell nichts diese
 * Komponente zeigt - ein separater, bereits bekannter und hier bewusst nicht behobener Bug, siehe
 * das Projekt-Ledger). Die frühere "ICS Kalender Import"-Karte wurde entfernt (Security-Bedenken:
 * der token-basierte Abo-Link ist nicht an eine Session gebunden, siehe kalender/ics/[token]/route.ts
 * und CLAUDE.md) - die Route selbst bleibt für bereits bestehende Abos aktiv, nur die
 * Entdeckbarkeit/Neuanmeldung über die UI wurde entfernt.
 */
export function KalenderFiltersContent({
  layers,
  enabled,
  onToggle,
  showDrone,
  sondergruppen,
  hiddenSondergruppen,
  onSondergruppeToggle,
}: KalenderFiltersContentProps) {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {layers.length > 1 && (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:rounded-lg sm:p-3">
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
        </div>
      )}

      {sondergruppen.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:rounded-lg sm:p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Sondergruppen</span>
          {sondergruppen.map((gruppe) => (
            <ToggleSwitch
              key={gruppe.id}
              label={gruppe.name}
              checked={!hiddenSondergruppen.has(gruppe.id)}
              onChange={(checked) => onSondergruppeToggle(gruppe.id, checked)}
            />
          ))}
        </div>
      )}

      <LayerLegend showDrone={showDrone} />
    </div>
  );
}
