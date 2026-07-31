import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // "Signalrot" palette (design pass, 2026-08) — DEFAULT tightened from the previous #f44336
        // to #e4322b; dark was already an exact match and is unchanged.
        brand: {
          DEFAULT: '#e4322b',
          dark: '#c62828',
        },
        // Grün-Ton, bisher nur als Hex-Literal in layer-colors.ts/NinetyDayRing verwendet - jetzt
        // auch als Tailwind-Token, seit Mobile-Brief.md aktive Schalter auf Mobile grün statt rot
        // will ("Rot bleibt der primären Aktion vorbehalten").
        status: {
          green: '#22a06b',
        },
      },
      fontFamily: {
        sans: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
