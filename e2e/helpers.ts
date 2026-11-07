import { expect, type Page } from '@playwright/test';

// Shared setup for the flow evals. Every spec creates its own trip against
// the live project (personal-scale, unguessable slugs — spec §Testing #3),
// so specs never interfere with each other and can run in any order.

export async function createTrip(page: Page, names = 'Erin, Sam'): Promise<string> {
  // No leading slash: with baseURL '…/grouptab/', a leading-slash path
  // replaces the whole pathname and drops the base.
  await page.goto('new');
  await page.getByPlaceholder('Tahoe 2026').fill(`E2E ${Date.now()}`);
  await page.getByPlaceholder('You, Jake, Maya').fill(names);
  // Creation requires an explicit "Which one is you?" pick — no auto-claim.
  // Claim the first listed name so specs can treat it as "You".
  const you = names.split(',')[0].trim();
  await page.getByRole('button', { name: you, exact: true }).click();
  await page.getByRole('button', { name: 'Create & copy link' }).click();
  await expect(page.getByText("you're even")).toBeVisible();

  const slug = /\/t\/([^/?#]+)/.exec(page.url())?.[1];
  expect(slug, `no trip slug in ${page.url()}`).toBeTruthy();
  return slug!;
}

/** Taps the in-app keypad, one character at a time ('90', '12.50', …). */
export async function typeAmount(page: Page, amount: string): Promise<void> {
  for (const key of amount) await page.getByRole('button', { name: key, exact: true }).click();
}

export async function clearAmount(page: Page, presses: number): Promise<void> {
  for (let i = 0; i < presses; i++) await page.getByRole('button', { name: '⌫', exact: true }).click();
}

/** Equal-split expense from the trip feed, leaving the browser back on the feed. */
export async function addEqualExpense(page: Page, amount: string, description: string): Promise<void> {
  await page.getByRole('link', { name: '+', exact: true }).click();
  await typeAmount(page, amount);
  await page.getByPlaceholder('What for? (required)').fill(description);
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(description)).toBeVisible();
}
