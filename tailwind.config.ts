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
