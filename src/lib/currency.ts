// Supported currencies and their ISO 4217 minor-unit exponents (feature 01,
// decision 8).
//
// The list is the rate source's (Frankfurter / ECB reference rates) plus USD,
// checked against https://api.frankfurter.dev/v1/currencies on 2026-11-09.
// The ECB retires currencies (BGN on Bulgaria's euro adoption, RUB in 2022);
// a retired code here only loses its rate pre-fill — typing still works.
//
// Exponents are HARDCODED rather than read from Intl: stored amounts are minor
// units, so every device must agree on what "850" means. Browsers' Intl data
// disagree for a few currencies (IDR, HUF, ISK); a mismatch would make one
// phone read an amount 100x off. Intl is used for the symbol only (format.ts).

export const SETTLEMENT_CURRENCY = 'USD';

const EXPONENTS: Record<string, number> = {
  USD: 2,
  AUD: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2, CZK: 2, DKK: 2, EUR: 2, GBP: 2,
  HKD: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2, ISK: 0, JPY: 0, KRW: 0, MXN: 2,
  MYR: 2, NOK: 2, NZD: 2, PHP: 2, PLN: 2, RON: 2, SEK: 2, SGD: 2, THB: 2,
  TRY: 2, ZAR: 2,
};

/** USD first, then alphabetical — the order the currency picker shows. */
export const SUPPORTED_CURRENCIES: string[] = [
  SETTLEMENT_CURRENCY,
  ...Object.keys(EXPONENTS).filter(c => c !== SETTLEMENT_CURRENCY).sort(),
];

export function isSupported(code: string): boolean {
  return Object.hasOwn(EXPONENTS, code);
}

/** Decimal places of the currency's minor unit. Unknown codes fall back to 2
 *  (the server accepts any well-formed code; display must not crash on one). */
export function exponentOf(code: string): number {
  return EXPONENTS[code] ?? 2;
}
