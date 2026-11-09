import { test, expect } from '@playwright/test';
import { createTrip, typeAmount } from './helpers';

// Feature 01 (multi-currency), end to end against the live project. The rate
// API is mocked so the spec never depends on Frankfurter being up, and so the
// expected USD numbers are exact: 1 MXN = $0.0586.
test('log pesos with a pre-filled rate, see ≈USD, settle in USD, change the rate', async ({ page }) => {
  await page.route('**/api.frankfurter.dev/**', route => route.fulfill({
    json: { amount: 1, base: 'MXN', date: '2026-11-06', rates: { USD: 0.0586 } },
  }));
  await createTrip(page);   // Erin (you) and Sam

  // First MXN expense: the rate row appears, pre-filled from the (mocked) API.
  await page.getByRole('link', { name: '+', exact: true }).click();
  await page.getByRole('button', { name: /Change currency/ }).click();
  await page.getByRole('button', { name: 'MXN', exact: true }).click();
  await expect(page.getByLabel('USD per MXN')).toHaveValue('0.0586');
  await typeAmount(page, '900');
  await page.getByPlaceholder('What for? (required)').fill('Tacos');
  await page.getByRole('button', { name: 'Save expense' }).click();

  // Feed: original amount, ≈USD beneath (90000 centavos × 0.0586 = $52.74).
  await expect(page.getByText('MX$900.00')).toBeVisible();
  await expect(page.getByText('≈ $52.74')).toBeVisible();
  // Balance hero is USD: Sam owes half, MX$450.00 = $26.37.
  await expect(page.getByText("you're owed")).toBeVisible();
  await expect(page.getByText('$26.37').first()).toBeVisible();

  // The next expense defaults to MXN and doesn't ask for a rate again.
  await page.getByRole('link', { name: '+', exact: true }).click();
  await expect(page.getByRole('button', { name: /Currency: MXN/ })).toBeVisible();
  await expect(page.getByLabel('USD per MXN')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  // Settle: the trip rate is listed and transfers are in USD.
  await page.getByRole('link', { name: 'Settle up' }).click();
  await expect(page.getByText('1 MXN = $0.0586')).toBeVisible();
  await expect(page.getByText('$26.37').first()).toBeVisible();
  await page.getByRole('switch').click();
  await expect(page.getByText('1 of 2 in', { exact: false })).toBeVisible();

  // Changing the rate moves the numbers and clears everyone's all-in.
  await page.getByRole('button', { name: 'edit', exact: true }).click();
  await page.getByLabel('USD per MXN').fill('0.06');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('1 MXN = $0.06')).toBeVisible();
  await expect(page.getByText('$27.00').first()).toBeVisible();          // MX$450.00 × 0.06
  await expect(page.getByText('0 of 2 in', { exact: false })).toBeVisible();
});

test('a zero-decimal currency takes whole units only', async ({ page }) => {
  await page.route('**/api.frankfurter.dev/**', route => route.fulfill({
    json: { amount: 1, base: 'JPY', date: '2026-11-06', rates: { USD: 0.0067 } },
  }));
  await createTrip(page);
  await page.getByRole('link', { name: '+', exact: true }).click();
  await page.getByRole('button', { name: /Change currency/ }).click();
  await page.getByRole('button', { name: 'JPY', exact: true }).click();
  await expect(page.getByRole('button', { name: '.', exact: true })).toBeDisabled();
  await typeAmount(page, '1200');
  await expect(page.getByText('¥1200')).toBeVisible();
  await page.getByPlaceholder('What for? (required)').fill('Ramen');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('¥1,200')).toBeVisible();
  await expect(page.getByText('≈ $8.04')).toBeVisible();
});
