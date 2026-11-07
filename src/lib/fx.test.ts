import { describe, it, expect } from 'vitest';
import {
  approxTotalUsdCents, approxUsdCents, computeUsdBalances, convertBalancesToUsd, missingRates,
  type MultiCurrencyExpense,
} from './fx';
import { computeBalances, computeEqualSplit } from './money';
import { exponentOf, isSupported, SUPPORTED_CURRENCIES } from './currency';

const MXN = 58_600_000;        // 1 MXN = $0.0586
const JPY = 6_700_000;         // 1 JPY = $0.0067
const EUR = 1_080_000_000;     // 1 EUR = $1.08
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('currency table', () => {
  it('lists USD first and only currencies with a known exponent', () => {
    expect(SUPPORTED_CURRENCIES[0]).toBe('USD');
    expect(SUPPORTED_CURRENCIES).toContain('MXN');
    for (const c of SUPPORTED_CURRENCIES) expect(isSupported(c)).toBe(true);
  });
  it('uses ISO 4217 exponents, not the browser', () => {
    expect(exponentOf('USD')).toBe(2);
    expect(exponentOf('JPY')).toBe(0);
    expect(exponentOf('KRW')).toBe(0);
    expect(exponentOf('ISK')).toBe(0);
    expect(exponentOf('IDR')).toBe(2);
    expect(exponentOf('HUF')).toBe(2);
  });
  it('falls back to 2 decimals for an unknown code instead of crashing', () => {
    expect(isSupported('XYZ')).toBe(false);
    expect(exponentOf('XYZ')).toBe(2);
  });
});

describe('convertBalancesToUsd', () => {
  it('converts exactly when the rate divides evenly', () => {
    // MX$1,000.00 owed = 100000 centavos × 0.0586 = $58.60
    expect(convertBalancesToUsd({ a: 100_000, b: -100_000 }, ['a', 'b'], 'MXN', MXN))
      .toEqual({ a: 5_860, b: -5_860 });
  });

  it('handles a zero-decimal currency (JPY minor unit = 1 yen)', () => {
    // ¥10,000 × 0.0067 = $67.00
    expect(convertBalancesToUsd({ a: 10_000, b: -10_000 }, ['a', 'b'], 'JPY', JPY))
      .toEqual({ a: 6_700, b: -6_700 });
  });

  it('always sums to exactly zero after rounding', () => {
    // MX$333.33 / 333.33 / -666.66: each converts to a fraction of a cent.
    const out = convertBalancesToUsd({ a: 33_333, b: 33_333, c: -66_666 }, ['a', 'b', 'c'], 'MXN', MXN);
    expect(sum(out)).toBe(0);
    for (const v of Object.values(out)) expect(Number.isInteger(v)).toBe(true);
  });

  it('gives the leftover cent to the largest remainder', () => {
    // At $0.01 per unit, 1 minor unit = 0.01 cents, so 140/160/−300 minor are
    // exactly 1.4 / 1.6 / −3.0 cents → floors 1, 1, −3 → the spare cent to b.
    const out = convertBalancesToUsd({ a: 140, b: 160, c: -300 }, ['a', 'b', 'c'], 'MXN', 10_000_000);
    expect(out).toEqual({ a: 1, b: 2, c: -3 });
  });

  it('breaks remainder ties by participant order', () => {
    // a and b both exactly 1.5 cents → one extra cent, goes to the first in order.
    const out = convertBalancesToUsd({ a: 150, b: 150, c: -300 }, ['a', 'b', 'c'], 'MXN', 10_000_000);
    expect(out).toEqual({ a: 2, b: 1, c: -3 });
    const flipped = convertBalancesToUsd({ a: 150, b: 150, c: -300 }, ['b', 'a', 'c'], 'MXN', 10_000_000);
    expect(flipped).toEqual({ a: 1, b: 2, c: -3 });
  });

  it('rejects a balance map that does not sum to zero, and a bad rate', () => {
    expect(() => convertBalancesToUsd({ a: 1 }, ['a'], 'MXN', MXN)).toThrow();
    expect(() => convertBalancesToUsd({ a: 0 }, ['a'], 'MXN', 0)).toThrow();
  });
});

describe('computeUsdBalances', () => {
  const ids = ['ann', 'ben', 'cal'];
  const usd = (payerId: string, amount: number): MultiCurrencyExpense =>
    ({ payerId, currency: 'USD', amountMinor: amount, shares: computeEqualSplit(amount, ids, payerId) });
  const mxn = (payerId: string, amount: number): MultiCurrencyExpense =>
    ({ payerId, currency: 'MXN', amountMinor: amount, shares: computeEqualSplit(amount, ids, payerId) });

  it('a USD-only trip is exactly computeBalances (today\'s behavior)', () => {
    const expenses = [usd('ann', 9_000), usd('ben', 3_001)];
    const settlements = [{ fromId: 'cal', toId: 'ann', amountCents: 2_000 }];
    expect(computeUsdBalances(ids, expenses, settlements, {})).toEqual(computeBalances(
      ids, expenses.map(e => ({ payerId: e.payerId, amountCents: e.amountMinor, shares: e.shares })), settlements));
  });

  it('converts a foreign-only trip once and keeps the zero sum', () => {
    // Ann pays MX$900.00 for three: each owes MX$300.00 = $17.58.
    const out = computeUsdBalances(ids, [mxn('ann', 90_000)], [], { MXN });
    expect(out).toEqual({ ann: 3_516, ben: -1_758, cal: -1_758 });
    expect(sum(out)).toBe(0);
  });

  it('mixes currencies and USD settlements', () => {
    const out = computeUsdBalances(
      ids, [mxn('ann', 90_000), usd('ben', 3_000)], [{ fromId: 'cal', toId: 'ann', amountCents: 1_000 }], { MXN },
    );
    // MXN part: ann +3516, ben −1758, cal −1758. USD part: ben +2000, ann −1000, cal −1000.
    // Settlement: cal +1000, ann −1000.
    expect(out).toEqual({ ann: 1_516, ben: 242, cal: -1_758 });
    expect(sum(out)).toBe(0);
  });

  it('leaves out a currency with no rate, and reports it', () => {
    const expenses = [mxn('ann', 90_000), { ...mxn('ben', 12_000), currency: 'EUR' }];
    expect(missingRates(expenses, { MXN })).toEqual(['EUR']);
    expect(computeUsdBalances(ids, expenses, [], { MXN })).toEqual({ ann: 3_516, ben: -1_758, cal: -1_758 });
  });

  it('a rate change moves every balance but keeps the zero sum', () => {
    const expenses = [mxn('ann', 90_001), mxn('ben', 33_333)];
    for (const rate of [MXN, 60_000_000, 51_234_567, 1]) {
      expect(sum(computeUsdBalances(ids, expenses, [], { MXN: rate }))).toBe(0);
    }
  });
});

describe('display estimates', () => {
  it('rounds the ≈USD line half up', () => {
    expect(approxUsdCents(85_000, 'MXN', { MXN })).toBe(4_981);     // 49.81
    expect(approxUsdCents(1_200, 'JPY', { JPY })).toBe(804);          // 8.04
    expect(approxUsdCents(1_000, 'EUR', { EUR })).toBe(1_080);
    expect(approxUsdCents(1_234, 'USD', {})).toBe(1_234);
    expect(approxUsdCents(100, 'EUR', {})).toBeNull();
  });

  it('totals each currency once', () => {
    expect(approxTotalUsdCents([
      { currency: 'MXN', amountMinor: 85_000 }, { currency: 'MXN', amountMinor: 15_000 },
      { currency: 'USD', amountMinor: 1_000 },
    ], { MXN })).toBe(5_860 + 1_000);
  });
});
