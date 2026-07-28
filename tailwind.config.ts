import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Matches the accent red used on afkdopurkersdorf.at (mobile menu button etc.).
        brand: {
          DEFAULT: '#f44336',
          dark: '#c62828',
        },
      },
      fontFamily: {
        sans: ['var(--font-noto-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
