import { test, expect } from '@playwright/test';
import { addEqualExpense, clearAmount, createTrip, typeAmount } from './helpers';

// The expense flows the happy path does not reach: subset splits, the custom
// split validator, editing, flagging, commenting and deleting. These are the
// paths where a wrong number would be silent — the feed still looks fine
// while someone's balance is off.

test('subset split, custom split validation, edit, flag, comment, delete', async ({ page }) => {
  await createTrip(page, 'Erin, Sam, Kai');

  // --- equal split across everyone: $90 → $30 each, Erin is owed $60 -------
  await addEqualExpense(page, '90', 'Groceries');
  await expect(page.getByText("you're owed")).toBeVisible();
  await expect(page.getByText('$60.00').first()).toBeVisible();
  await expect(page.getByText('$90.00 trip total')).toBeVisible();

  await page.getByText('Groceries').click();
  await expect(page.getByText('SPLIT · EVERYONE')).toBeVisible();
  await expect(page.getByText('$30.00').first()).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();

  // --- subset split: tap Kai out, $50 splits two ways ----------------------
  await page.getByRole('link', { name: '+', exact: true }).click();
  await typeAmount(page, '50');
  await page.getByPlaceholder('What for? (required)').fill('Two of us');
  await page.getByRole('button', { name: 'Toggle Kai' }).click();
  await expect(page.getByText('$25.00 each')).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();

  await expect(page.getByText('Two of us')).toBeVisible();
  await page.getByText('Two of us').click();
  await expect(page.getByText('SPLIT · 2 PEOPLE')).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();

  // --- custom split: save stays blocked until the amounts add up ----------
  await page.getByRole('link', { name: '+', exact: true }).click();
  await typeAmount(page, '30');
  await page.getByPlaceholder('What for? (required)').fill('Custom split');
  await page.getByRole('button', { name: /^Split equally/ }).click();

  const customInputs = page.getByPlaceholder('0.00');
  await customInputs.nth(0).fill('10');
  await customInputs.nth(1).fill('5');
  await expect(page.getByText('$15.00 of $30.00 assigned')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save expense' })).toBeDisabled();

  await customInputs.nth(2).fill('15');
  await expect(page.getByText('adds up to $30.00 ✓')).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Custom split')).toBeVisible();

  // --- edit: $90 → $60, split evenly by hand; "edited" marker appears ------
  await page.getByText('Groceries').click();
  await page.getByRole('button', { name: '✎ edit' }).click();
  await clearAmount(page, 5);                      // "90.00" → ""
  await typeAmount(page, '60');
  // Edit mode opens in custom mode with the stored shares (30/30/30), which
  // no longer add up to the new total — save must be blocked until they do.
  await expect(page.getByText('$90.00 of $60.00 assigned')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

  const editInputs = page.getByPlaceholder('0.00');
  for (let i = 0; i < 3; i++) await editInputs.nth(i).fill('20');
  await expect(page.getByText('adds up to $60.00 ✓')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('edited')).toBeVisible();
  await expect(page.getByText('$20.00').first()).toBeVisible();

  // --- flag, resolve, and comment ------------------------------------------
  await page.getByRole('button', { name: '⚑ Flag for review' }).click();
  await expect(page.getByText('⚑ Flagged by You')).toBeVisible();

  await page.getByPlaceholder('Add a comment…').fill('this was the boat deposit');
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect(page.getByText('this was the boat deposit')).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('button', { name: '⚑ Flag for review' })).toBeVisible();

  // --- delete: confirmation first, then the expense is gone from the feed --
  await page.getByRole('button', { name: 'Delete expense…' }).click();
  await expect(page.getByText('Delete this expense?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Delete this expense?')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete expense…' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Groceries')).toHaveCount(0);
  await expect(page.getByText('Two of us')).toBeVisible();   // the others survive
});
