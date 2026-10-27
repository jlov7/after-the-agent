import type { Page } from '@playwright/test';

export async function openEvidenceExports(page: Page) {
  if (!await page.getByRole('button', { name: 'Download attempt evidence', exact: true }).isVisible()) {
    await page.getByText('Export and inspect evidence', { exact: true }).click();
  }
}
