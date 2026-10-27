import { defineConfig } from '@playwright/test';
const base = process.env.BASE || '/';
export default defineConfig({ testDir: './tests/ui', timeout: 30000, fullyParallel: false, workers: 1, use: { baseURL: `http://127.0.0.1:4173${base}`, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' }, webServer: { command: 'npm run build && npm run preview --workspace @ata/web -- --port 4173', url: `http://127.0.0.1:4173${base}`, reuseExistingServer: false } });
