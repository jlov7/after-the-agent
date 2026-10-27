import { expect, test } from '@playwright/test';
test('production source and license links resolve to local content with bundled dependency notices', async ({ page, request }) => {
  await page.goto('./');
  const response = await request.get('THIRD_PARTY_NOTICES.txt');
  expect(response.ok()).toBe(true);
  const notices = await response.text();
  for (const dependency of ['react', 'react-dom', 'scheduler', 'ajv', '@noble/hashes', 'zod']) expect(notices).toContain(dependency);
  expect(notices).toContain('Permission is hereby granted');
  expect(notices).not.toMatch(/\/(?:Users|home)\/[^\s/]+\//);
  await page.getByRole('link', { name: 'Third-party notices', exact: true }).click();
  await expect(page.locator('body')).toContainText('Permission is hereby granted');
  const source = await request.get('docs/source-map.html'); expect(source.ok()).toBe(true);
});
