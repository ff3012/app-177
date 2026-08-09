import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { LayerLegend } from './layer-legend';
import type { CalendarLayer, IcsLink } from './kalender-with-layers';

interface KalenderFiltersContentProps {
  layers: CalendarLayer[];
  enabled: Record<string, boolean>;
  onToggle: (key: string, checked: boolean) => void;
  showDrone: boolean;
  icsLinks: IcsLink[];
}

/**
 * Ebenen-Toggles + Legende + ICS-Import - seit der Kalender-Desktop-Browser-Ansicht (Task 2,
 * `kalender-desktop-sidebar.tsx`) NUR NOCH für das mobile Bottom-Sheet (Mobile-Brief.md) zuständig -
 * die `lg:`-Sidebar hat eine eigene Komponente (`KalenderDesktopSidebar`), da ihr Inhalt (keine
 * Legende-Karte, dafür eine neue "Nur anzeigen"-Statusfilter-Karte) genuin abweicht. Diese Komponente
 * hat aktuell genau eine Einbindestelle - innerhalb des `BottomSheet` in `kalender-with-layers.tsx` -
 * und wird im Tablet-Breitenbereich (640-1023px) nirgends im Seitenfluss gerendert (der Desktop-
 * Sidebar-Wrapper ist `hidden lg:flex`, wodurch zwischen 640px und 1024px aktuell nichts diese
 * Komponente zeigt - ein separater, bereits bekannter und hier bewusst nicht behobener Bug, siehe
 * das Projekt-Ledger). Responsive Feinheiten (Kartendichte, ICS-Linkfarbe) stecken hier direkt über
 * sm:-Klassen, auch wenn die einzige aktuelle Einbindung unterhalb von sm: liegt.
 */
export function KalenderFiltersContent({
  layers,
  enabled,
  onToggle,
  showDrone,
  icsLinks,
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

      <LayerLegend showDrone={showDrone} />

      <div className="rounded-xl bg-white p-4 shadow-sm sm:rounded-lg sm:p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">ICS Kalender Import</h2>
        <div className="flex flex-col gap-2 text-sm">
          {icsLinks.map((link) => (
            <div key={link.href} className="flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 text-brand"
                aria-hidden
              >
                <rect x="3" y="5" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
              </svg>
              <a href={link.href} className="text-neutral-800 hover:underline sm:text-brand">
                {link.label}
              </a>
              <CopyLinkButton text={link.copyText} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
