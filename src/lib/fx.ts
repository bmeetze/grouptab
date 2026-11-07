// Currency conversion — the ONLY place a foreign amount becomes USD
// (feature 01, decisions 2, 3, 9).
//
// Everything here is integer math on BigInt. A rate is an integer count of
// billionths of a USD per ONE major unit of the currency ("nanos"; MXN 0.0586
// -> 58_600_000), so converting `minor` units is the exact fraction
//
//   minor × nanos / 10^(exponent + 7)   USD cents      (1 cent = 10^7 nanos)
//
// Balances are converted once per person per currency, floored, and the cents
// still needed for the group to sum to exactly zero go to the largest
// remainders (ties: participant order). evals/invariants.test.ts forbids float
// rounding in this file.

import { computeBalances, type ExpenseInput, type SettlementInput } from './money';
import { exponentOf, SETTLEMENT_CURRENCY } from './currency';

/** Foreign-currency rates for a trip: currency code -> nanos-USD per major unit. */
export type Rates = Record<string, number>;

export interface MultiCurrencyExpense {
  payerId: string;
  currency: string;
  amountMinor: number;
  shares: Record<string, number>;   // minor units of `currency`
}

const NANOS_PER_CENT_DIGITS = 7n;

function denominator(currency: string): bigint {
  return 10n ** (BigInt(exponentOf(currency)) + NANOS_PER_CENT_DIGITS);
}

/** Floor division that rounds toward −∞ (BigInt `/` truncates toward zero). */
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
}

function toSafeNumber(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('converted amount out of range');
  return n;
}

/** Converts one currency's balance map to USD cents. The input must sum to
 *  zero (any per-currency balance map from computeBalances does); the output
 *  then sums to exactly zero too. `order` fixes the tie-break. */
export function convertBalancesToUsd(
  balances: Record<string, number>, order: string[], currency: string, nanos: number,
): Record<string, number> {
  if (!Number.isSafeInteger(nanos) || nanos <= 0) throw new Error(`invalid rate for ${currency}`);
  const den = denominator(currency);
  const rate = BigInt(nanos);
  const ids = [...order, ...Object.keys(balances).filter(id => !order.includes(id))];

  const floors = new Map<string, bigint>();
  const remainders: { id: string; rem: bigint; at: number }[] = [];
  let sumFloors = 0n;
  let sumMinor = 0n;
  ids.forEach((id, at) => {
    const minor = BigInt(balances[id] ?? 0);
    sumMinor += minor;
    const num = minor * rate;
    const q = floorDiv(num, den);
    floors.set(id, q);
    sumFloors += q;
    remainders.push({ id, rem: num - q * den, at });
  });
  if (sumMinor !== 0n) throw new Error(`${currency} balances must sum to zero`);

  // Exact values sum to 0 and each floor loses [0, 1) cent, so the shortfall
  // is a whole number of cents in [0, n).
  let shortfall = -sumFloors;
  remainders.sort((a, b) => (a.rem === b.rem ? a.at - b.at : a.rem > b.rem ? -1 : 1));
  for (const r of remainders) {
    if (shortfall === 0n) break;
    floors.set(r.id, (floors.get(r.id) ?? 0n) + 1n);
    shortfall -= 1n;
  }

  const out: Record<string, number> = {};
  for (const id of ids) out[id] = toSafeNumber(floors.get(id) ?? 0n);
  return out;
}

/** Currencies that have expenses but no rate yet (normally none: the first
 *  expense in a currency saves its rate in the same transaction). */
export function missingRates(expenses: MultiCurrencyExpense[], rates: Rates): string[] {
  const missing = new Set<string>();
  for (const e of expenses) {
    if (e.currency !== SETTLEMENT_CURRENCY && !(e.currency in rates)) missing.add(e.currency);
  }
  return [...missing].sort();
}

/** Every displayed USD balance derives from this: computeBalances once per
 *  currency (settlements, always USD, join the USD group), each foreign map
 *  converted once, then summed. A USD-only trip is exactly computeBalances.
 *  Currencies without a rate are left out (see missingRates). */
export function computeUsdBalances(
  participantIds: string[],
  expenses: MultiCurrencyExpense[],
  settlements: SettlementInput[],
  rates: Rates,
): Record<string, number> {
  const byCurrency = new Map<string, ExpenseInput[]>();
  for (const e of expenses) {
    const group = byCurrency.get(e.currency) ?? [];
    group.push({ payerId: e.payerId, amountCents: e.amountMinor, shares: e.shares });
    byCurrency.set(e.currency, group);
  }

  const total = computeBalances(participantIds, byCurrency.get(SETTLEMENT_CURRENCY) ?? [], settlements);
  for (const [currency, group] of byCurrency) {
    if (currency === SETTLEMENT_CURRENCY || !(currency in rates)) continue;
    const native = computeBalances(participantIds, group, []);
    const usd = convertBalancesToUsd(native, participantIds, currency, rates[currency]);
    for (const [id, cents] of Object.entries(usd)) total[id] = (total[id] ?? 0) + cents;
  }
  return total;
}

/** Display-only estimate (the "≈ $" line under a foreign amount, trip totals): round half up.
 *  May differ from the balance math by a cent — the ≈ says so. */
export function approxUsdCents(minor: number, currency: string, rates: Rates): number | null {
  if (currency === SETTLEMENT_CURRENCY) return minor;
  const nanos = rates[currency];
  if (nanos === undefined) return null;
  const den = denominator(currency);
  const num = BigInt(minor) * BigInt(nanos);
  return toSafeNumber(floorDiv(2n * num + den, 2n * den));
}

/** Trip total in USD: each currency's total converted once. Currencies
 *  without a rate are skipped. */
export function approxTotalUsdCents(expenses: { currency: string; amountMinor: number }[], rates: Rates): number {
  const byCurrency = new Map<string, number>();
  for (const e of expenses) byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + e.amountMinor);
  let total = 0;
  for (const [currency, minor] of byCurrency) total += approxUsdCents(minor, currency, rates) ?? 0;
  return total;
}

/** USD balances for a whole loaded trip — the one call every screen makes
 *  (Home, TripFeed and Settle each used to assemble computeBalances inputs). */
export function tripUsdBalances(data: {
  participants: { id: string }[];
  expenses: { payerParticipantId: string; currency: string; amountMinor: number; shares: Record<string, number> }[];
  settlements: { fromParticipantId: string; toParticipantId: string; amountCents: number }[];
  rates: Rates;
}): Record<string, number> {
  return computeUsdBalances(
    data.participants.map(p => p.id),
    data.expenses.map(e => ({ payerId: e.payerParticipantId, currency: e.currency, amountMinor: e.amountMinor, shares: e.shares })),
    data.settlements.map(s => ({ fromId: s.fromParticipantId, toId: s.toParticipantId, amountCents: s.amountCents })),
    data.rates,
  );
}
