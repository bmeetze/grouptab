import { test, expect } from '@playwright/test';

// Full happy path against the live Supabase project (personal-scale, unguessable
// slugs — acceptable per spec Testing #3). Runs local-only; not wired into CI.
test('create → claim → expense → balances → all-in → settle → close', async ({ page }) => {
  // Create (creator auto-claims the first name in the list)
  // Note: no leading slash — with baseURL 'http://localhost:5173/grouptab/',
  // a leading-slash path replaces the whole pathname and drops '/grouptab'.
  await page.goto('new');
  await page.getByPlaceholder('Tahoe 2026').fill(`E2E ${Date.now()}`);
  await page.getByPlaceholder('You, Jake, Maya').fill('Erin, Sam');
  await page.getByRole('button', { name: 'Create & copy link' }).click();

  // Add a $90 expense split equally between both
  await expect(page.getByText("you're even")).toBeVisible();
  await page.getByRole('link', { name: '+', exact: true }).click();
  for (const key of ['9', '0']) await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByPlaceholder('What for? (required)').fill('Boat deposit');
  await page.getByRole('button', { name: 'Save expense' }).click();

  // Feed + balance: Erin paid 90, owes 45 → owed 45
  await expect(page.getByText('Boat deposit')).toBeVisible();
  await expect(page.getByText("you're owed")).toBeVisible();
  await expect(page.getByText('$45.00', { exact: false }).first()).toBeVisible();

  // All-in (Sam is unclaimed; only Erin's flag gates her own toggle — badge stays DRAFT)
  await page.getByRole('link', { name: 'Settle up' }).click();
  await expect(page.getByText('DRAFT — may change')).toBeVisible();
  await page.getByRole('switch').click();
  await expect(page.getByText('1 of 2 in', { exact: false })).toBeVisible();

  // Settle: Sam pays Erin 45 → all squared → close
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByText('All squared up')).toBeVisible();
  await page.getByRole('button', { name: /Close trip/ }).click();
  await expect(page.getByText('Trip closed · read-only')).toBeVisible();
});
