import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), base = process.env.BASE || '/';
export default defineConfig({
  testDir: `${root}/tests/ui`, testMatch: ['v1-*.spec.ts', 'portability.spec.ts', 'genuine-recording.spec.ts', 'clarity.spec.ts'],
  forbidOnly: true, retries: 0, timeout: 45000, fullyParallel: false, workers: 1,
  use: { baseURL: `http://127.0.0.1:4173${base}`, viewport: { width: 1440, height: 900 }, headless: true, trace: 'retain-on-failure' },
  projects: [{ name: 'firefox', use: { browserName: 'firefox' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { cwd: root, command: 'npm run build && npm run preview --workspace @ata/web -- --port 4173', url: `http://127.0.0.1:4173${base}`, reuseExistingServer: false },
});
