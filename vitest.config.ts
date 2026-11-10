import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig nutzt jsx: preserve (Next.js) - für die PDF-Tests muss vitest JSX selbst übersetzen.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tests gegen die echte lokale Datenbank laufen separat: npm run test:db
    exclude: ['**/node_modules/**', 'src/**/*.db.test.ts'],
  },
});
