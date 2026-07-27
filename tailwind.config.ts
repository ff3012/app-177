import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#c1121f',
          dark: '#780000',
        },
      },
    },
  },
  plugins: [],
};

export default config;
