import { test, expect } from '@playwright/test';
import { addEqualExpense, createTrip } from './helpers';

// "Closed trips are fully read-only" (spec §Edge Cases). Hiding the buttons
// is only half of it — the routes stay reachable by URL, so this walks in
// through the front door of every write surface after the trip is closed.

test('a closed trip offers no write affordance on any screen', async ({ page }) => {
  const slug = await createTrip(page);
  await addEqualExpense(page, '90', 'Boat deposit');

  // Settle and close.
  await page.getByRole('link', { name: 'Settle up' }).click();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByText('All squared up')).toBeVisible();
  await page.getByRole('button', { name: /Close trip/ }).click();
  await expect(page.getByText('Trip closed · read-only')).toBeVisible();

  // Settle tab: no toggle, no transfer actions, no second close.
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Close trip/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible();  // reads still work

  // Feed: banner shown, quick-add gone.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByText('Trip closed · read-only')).toBeVisible();
  await expect(page.getByRole('link', { name: '+', exact: true })).toHaveCount(0);
  await expect(page.getByText('Boat deposit')).toBeVisible();

  // Expense detail: no edit, flag, comment or delete.
  await page.getByText('Boat deposit').click();
  await expect(page.getByRole('button', { name: '✎ edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '⚑ Flag for review' })).toHaveCount(0);
  await expect(page.getByPlaceholder('Add a comment…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete expense…' })).toHaveCount(0);
  await expect(page.getByText('SPLIT · EVERYONE')).toBeVisible();                  // still readable

  // The add-expense route, reached directly by URL, refuses to render a form.
  await page.goto(`t/${slug}/add`);
  await expect(page.getByText('Trip closed · read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save expense' })).toHaveCount(0);
  await expect(page.getByPlaceholder('What for? (required)')).toHaveCount(0);
});
