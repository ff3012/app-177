import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integrationstests gegen die LOKALE Entwicklungsdatenbank (DATABASE_URL aus .env). Jeder Test räumt seine
// Fixtures selbst wieder auf. Niemals gegen Dev/Prod-Server ausführen.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
