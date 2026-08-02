import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  // 'class' statt 'media': ohne dass irgendwo im Baum eine .dark-Klasse gesetzt wird (die App ist
  // bewusst fixed-light, siehe globals.css/color-scheme:light), bleiben dadurch alle dark:-Varianten
  // in von shadcn generierten Komponenten dauerhaft inaktiv, statt versehentlich auf
  // prefers-color-scheme:dark zu reagieren.
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      screens: {
        'dash-sm': '1200px',
        'dash-md': '1600px',
        'dash-lg': '2400px',
      },
      colors: {
        // "Signalrot" palette (design pass, 2026-08) — DEFAULT tightened from the previous #f44336
        // to #e4322b; dark was already an exact match and is unchanged. hover/subtle ergänzt für
        // Verwaltung-Brief.md, ohne DEFAULT/dark anzutasten (Kalender/Drohnengruppe/Mobile-Header
        // hängen daran).
        brand: {
          DEFAULT: '#e4322b',
          dark: '#c62828',
          hover: 'var(--brand-hover)',
          subtle: 'var(--brand-subtle)',
        },
        // Grün-Ton, bisher nur als Hex-Literal in layer-colors.ts/NinetyDayRing verwendet - jetzt
        // auch als Tailwind-Token, seit Mobile-Brief.md aktive Schalter auf Mobile grün statt rot
        // will ("Rot bleibt der primären Aktion vorbehalten").
        status: {
          green: '#22a06b',
        },
        // Verwaltung-Brief.md Tokenschicht - siehe globals.css für die zugrunde liegenden
        // CSS-Variablen. ink/line/surface/success/warning/danger sind eigene, benannte Familien;
        // background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/
        // input/ring sind zusätzlich die von shadcn-generierten Komponenten erwarteten Alias-Namen,
        // auf dieselben Variablen gemappt statt doppelt gepflegt.
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          sunken: 'var(--surface-sunken)',
          raised: 'var(--surface-raised)',
        },
        success: {
          DEFAULT: 'var(--success)',
          subtle: 'var(--success-subtle)',
          text: 'var(--success-text)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          subtle: 'var(--warning-subtle)',
          text: 'var(--warning-text)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          subtle: 'var(--danger-subtle)',
        },
        background: 'var(--surface)',
        foreground: 'var(--ink)',
        card: { DEFAULT: 'var(--surface)', foreground: 'var(--ink)' },
        popover: { DEFAULT: 'var(--surface)', foreground: 'var(--ink)' },
        primary: { DEFAULT: '#e4322b', foreground: '#ffffff' },
        secondary: { DEFAULT: 'var(--surface-sunken)', foreground: 'var(--ink)' },
        muted: { DEFAULT: 'var(--surface-sunken)', foreground: 'var(--ink-muted)' },
        accent: { DEFAULT: 'var(--surface-sunken)', foreground: 'var(--ink)' },
        destructive: { DEFAULT: 'var(--danger)', foreground: '#ffffff' },
        border: 'var(--line)',
        input: 'var(--line)',
        ring: 'var(--line-strong)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 6px)',
      },
      boxShadow: {
        // Einzige Karten-Schatten-Ebene für Verwaltung, ersetzt Rahmen auf Karten (Verwaltung-Brief.md).
        card: '0 1px 3px rgba(28,28,30,.10)',
      },
      fontFamily: {
        sans: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'ui-monospace', 'monospace'],
        // Nur für Kennzahlen (Verwaltung-Brief.md), nicht als allgemeine Schriftfamilie gedacht.
        condensed: ['var(--font-barlow-condensed)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
