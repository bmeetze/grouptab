import { describe, it, expect } from 'vitest';
import {
  computeEqualSplit, computeBalances, simplifyDebts,
  type ExpenseInput, type SettlementInput,
} from './money';

// Scenario-level evals for the correctness core. money.test.ts covers each
// function in isolation; this file evaluates them the way the app composes
// them — a whole trip's expenses and settlements in, a settle-up sequence
// out — and asserts the invariants that make the numbers trustworthy:
//
//   1. Conservation      — money is never created or destroyed.
//   2. Exactness         — every value is integer cents; shares sum to the total.
//   3. Termination       — following the suggested transfers always reaches
//                          all-zero, in at most n-1 payments.
//   4. Path independence — the same facts produce the same balances no matter
//                          what order they arrived in.
//
// The settle-loop eval is the closest thing here to a live test of the Settle
// screen: it does exactly what "Mark paid" does (record a settlement for the
// suggested transfer, then recompute everything from scratch).

// ---------- helpers ----------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Independent re-derivation of the spec's balance rule, used to cross-check
 *  computeBalances rather than restating its implementation. */
function balanceByDefinition(
  id: string, expenses: ExpenseInput[], settlements: SettlementInput[],
): number {
  const paid = sum(expenses.filter(e => e.payerId === id).map(e => e.amountCents));
  const owed = sum(expenses.map(e => e.shares[id] ?? 0));
  const sent = sum(settlements.filter(s => s.fromId === id).map(s => s.amountCents));
  const received = sum(settlements.filter(s => s.toId === id).map(s => s.amountCents));
  return paid - owed + sent - received;
}

/** Applies a transfer list to a balance map, as recording those settlements would. */
function applyTransfers(balances: Record<string, number>, transfers: { fromId: string; toId: string; amountCents: number }[]) {
  const after = { ...balances };
  for (const t of transfers) { after[t.fromId] += t.amountCents; after[t.toId] -= t.amountCents; }
  return after;
}

// mulberry-style LCG — deterministic, so a failure is always reproducible.
function prng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** k positive integers summing exactly to total (total >= k). */
function randomComposition(total: number, k: number, rand: () => number): number[] {
  const cuts = new Set<number>();
  while (cuts.size < k - 1) cuts.add(1 + Math.floor(rand() * (total - 1)));
  const sorted = [...cuts].sort((a, b) => a - b);
  const parts: number[] = [];
  let prev = 0;
  for (const c of sorted) { parts.push(c - prev); prev = c; }
  parts.push(total - prev);
  return parts;
}

interface RandomTrip { ids: string[]; expenses: ExpenseInput[] }

function randomTrip(rand: () => number): RandomTrip {
  const n = 2 + Math.floor(rand() * 6);              // 2–7 people
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const expenseCount = 1 + Math.floor(rand() * 12);
  const expenses: ExpenseInput[] = [];
  for (let i = 0; i < expenseCount; i++) {
    const payerId = ids[Math.floor(rand() * n)];
    // A random non-empty subset, in canonical participant order.
    const included = ids.filter(() => rand() < 0.7);
    if (included.length === 0) included.push(ids[Math.floor(rand() * n)]);
    const amountCents = 100 + Math.floor(rand() * 50_000);
    const shares = rand() < 0.6
      ? computeEqualSplit(amountCents, included, payerId)
      : Object.fromEntries(
          randomComposition(amountCents, included.length, rand).map((c, j) => [included[j], c]),
        );
    expenses.push({ payerId, amountCents, shares });
  }
  return { ids, expenses };
}

// ---------- golden scenarios (hand-checked against the spec) ----------

describe('trip scenarios', () => {
  it('spec example: $100 three ways records 3334/3333/3333', () => {
    const shares = computeEqualSplit(10_000, ['a', 'b', 'c'], 'a');
    expect(shares).toEqual({ a: 3334, b: 3333, c: 3333 });
    expect(sum(Object.values(shares))).toBe(10_000);
  });

  it('a full weekend trip nets out to the expected transfers', () => {
    // Ann pays $120 dinner for all 3; Ben pays $45 gas for all 3;
    // Cal pays $60 for just Ann and himself (Ben was not there).
    const ids = ['ann', 'ben', 'cal'];
    const expenses: ExpenseInput[] = [
      { payerId: 'ann', amountCents: 12_000, shares: computeEqualSplit(12_000, ids, 'ann') },
      { payerId: 'ben', amountCents: 4_500, shares: computeEqualSplit(4_500, ids, 'ben') },
      { payerId: 'cal', amountCents: 6_000, shares: computeEqualSplit(6_000, ['ann', 'cal'], 'cal') },
    ];
    const balances = computeBalances(ids, expenses, []);
    // Ann: paid 12000, owes 4000 + 1500 + 3000 = 8500 → +3500
    // Ben: paid 4500,  owes 4000 + 1500          = 5500 → -1000
    // Cal: paid 6000,  owes 4000 + 1500 + 3000   = 8500 → -2500
    expect(balances).toEqual({ ann: 3500, ben: -1000, cal: -2500 });

    const transfers = simplifyDebts(balances);
    expect(transfers).toEqual([
      { fromId: 'cal', toId: 'ann', amountCents: 2500 },
      { fromId: 'ben', toId: 'ann', amountCents: 1000 },
    ]);
    expect(Object.values(applyTransfers(balances, transfers)).every(v => v === 0)).toBe(true);
  });

  it('a payer outside the split is owed the whole expense', () => {
    const balances = computeBalances(['a', 'b', 'c'], [
      { payerId: 'a', amountCents: 7_501, shares: computeEqualSplit(7_501, ['b', 'c'], 'a') },
    ], []);
    // Payer excluded → leftover cent goes to the first split participant (b).
    expect(balances).toEqual({ a: 7_501, b: -3_751, c: -3_750 });
  });

  it('an odd amount split 7 ways sums exactly, with the payer absorbing the leftover', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const shares = computeEqualSplit(10_001, ids, 'p3');   // 10001 = 7 × 1428 + 5
    expect(sum(Object.values(shares))).toBe(10_001);
    for (const id of ids) expect(shares[id]).toBe(id === 'p3' ? 1_433 : 1_428);
  });

  it('marking the suggested transfer paid clears the debt to exactly zero', () => {
    const expenses: ExpenseInput[] = [
      { payerId: 'a', amountCents: 9_000, shares: computeEqualSplit(9_000, ['a', 'b'], 'a') },
    ];
    const before = computeBalances(['a', 'b'], expenses, []);
    const [t] = simplifyDebts(before);
    expect(t).toEqual({ fromId: 'b', toId: 'a', amountCents: 4_500 });
    const after = computeBalances(['a', 'b'], expenses,
      [{ fromId: t.fromId, toId: t.toId, amountCents: t.amountCents }]);
    expect(after).toEqual({ a: 0, b: 0 });
    expect(simplifyDebts(after)).toEqual([]);
  });

  it('adding then deleting an expense returns balances exactly to where they were', () => {
    // Balances are derived, never stored, so a delete must leave no residue.
    const ids = ['a', 'b', 'c'];
    const base: ExpenseInput[] = [
      { payerId: 'a', amountCents: 3_333, shares: computeEqualSplit(3_333, ids, 'a') },
    ];
    const late: ExpenseInput = {
      payerId: 'b', amountCents: 1_000, shares: computeEqualSplit(1_000, ids, 'b'),
    };
    const before = computeBalances(ids, base, []);
    const during = computeBalances(ids, [...base, late], []);
    const after = computeBalances(ids, [...base, late].filter(e => e !== late), []);

    expect(during).not.toEqual(before);       // the late expense really moved the numbers
    expect(after).toEqual(before);            // and removing it moved them all the way back
    expect(sum(Object.values(during))).toBe(0);
  });
});

// ---------- property evals over randomized trips ----------

describe('trip invariants (500 randomized trips)', () => {
  const trips = Array.from({ length: 500 }, (_, i) => randomTrip(prng(1000 + i)));

  it('every recorded split sums exactly to its expense amount', () => {
    for (const { expenses } of trips) {
      for (const e of expenses) {
        expect(sum(Object.values(e.shares))).toBe(e.amountCents);
        for (const c of Object.values(e.shares)) {
          expect(Number.isSafeInteger(c)).toBe(true);
          expect(c).toBeGreaterThan(0);
        }
      }
    }
  });

  it('balances are integer cents and always sum to zero', () => {
    for (const { ids, expenses } of trips) {
      const balances = computeBalances(ids, expenses, []);
      for (const v of Object.values(balances)) expect(Number.isSafeInteger(v)).toBe(true);
      expect(sum(Object.values(balances))).toBe(0);
    }
  });

  it('each balance equals paid − shares + sent − received', () => {
    for (const { ids, expenses } of trips) {
      const settlements: SettlementInput[] = ids.length > 1
        ? [{ fromId: ids[1], toId: ids[0], amountCents: 250 }]
        : [];
      const balances = computeBalances(ids, expenses, settlements);
      for (const id of ids) {
        expect(balances[id]).toBe(balanceByDefinition(id, expenses, settlements));
      }
    }
  });

  it('balances do not depend on the order expenses arrived in', () => {
    for (const { ids, expenses } of trips) {
      const forward = computeBalances(ids, expenses, []);
      const reversed = computeBalances(ids, [...expenses].reverse(), []);
      expect(reversed).toEqual(forward);
    }
  });

  it('transfers settle everyone, are positive, and never self-directed', () => {
    for (const { ids, expenses } of trips) {
      const balances = computeBalances(ids, expenses, []);
      const transfers = simplifyDebts(balances);
      const owed = sum(Object.values(balances).filter(v => v > 0));
      expect(sum(transfers.map(t => t.amountCents))).toBe(owed);
      for (const t of transfers) {
        expect(t.fromId).not.toBe(t.toId);
        expect(t.amountCents).toBeGreaterThan(0);
        expect(Number.isSafeInteger(t.amountCents)).toBe(true);
      }
      expect(Object.values(applyTransfers(balances, transfers)).every(v => v === 0)).toBe(true);
    }
  });

  it('never suggests more than n-1 transfers', () => {
    for (const { ids, expenses } of trips) {
      const balances = computeBalances(ids, expenses, []);
      const nonZero = Object.values(balances).filter(v => v !== 0).length;
      expect(simplifyDebts(balances).length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
    }
  });

  it('a settled trip suggests nothing further', () => {
    for (const { ids, expenses } of trips) {
      const balances = computeBalances(ids, expenses, []);
      const settlements = simplifyDebts(balances)
        .map(t => ({ fromId: t.fromId, toId: t.toId, amountCents: t.amountCents }));
      expect(simplifyDebts(computeBalances(ids, expenses, settlements))).toEqual([]);
    }
  });
});

// ---------- the settle-up loop, as the Settle screen runs it ----------

describe('settle-up loop', () => {
  it('paying the top suggested transfer repeatedly reaches all-zero, monotonically', () => {
    for (let i = 0; i < 300; i++) {
      const { ids, expenses } = randomTrip(prng(9000 + i));
      const settlements: SettlementInput[] = [];
      let remaining = simplifyDebts(computeBalances(ids, expenses, settlements));
      let outstanding = sum(remaining.map(t => t.amountCents));
      let rounds = 0;

      while (remaining.length > 0) {
        // Exactly what handleMarkPaid does: record the transfer, refetch,
        // recompute balances and transfers from the stored rows.
        const t = remaining[0];
        settlements.push({ fromId: t.fromId, toId: t.toId, amountCents: t.amountCents });
        remaining = simplifyDebts(computeBalances(ids, expenses, settlements));

        const nowOutstanding = sum(remaining.map(t2 => t2.amountCents));
        expect(nowOutstanding).toBeLessThan(outstanding);   // strict progress: no settle loop
        outstanding = nowOutstanding;

        rounds++;
        expect(rounds).toBeLessThanOrEqual(ids.length);      // terminates in ≤ n-1 payments
      }

      const final = computeBalances(ids, expenses, settlements);
      expect(Object.values(final).every(v => v === 0)).toBe(true);
      expect(settlements.length).toBeLessThanOrEqual(Math.max(0, ids.length - 1));
    }
  });

  it('an overpayment flips the balance rather than losing the money', () => {
    // Not a supported flow (amounts come from the suggested transfer), but if
    // it ever happens the books must still balance — money is never dropped.
    const ids = ['a', 'b'];
    const expenses: ExpenseInput[] = [
      { payerId: 'a', amountCents: 1_000, shares: computeEqualSplit(1_000, ids, 'a') },
    ];
    const balances = computeBalances(ids, expenses, [{ fromId: 'b', toId: 'a', amountCents: 800 }]);
    expect(balances).toEqual({ a: -300, b: 300 });
    expect(sum(Object.values(balances))).toBe(0);
    expect(simplifyDebts(balances)).toEqual([{ fromId: 'a', toId: 'b', amountCents: 300 }]);
  });
});

// ---------- multi-currency (feature 01) ----------
// The same invariants with expenses in up to three currencies, converted once
// to USD by fx.ts. Amounts are reused from randomTrip as minor units of a
// randomly chosen currency; rates span cheap (IDR-like) to dear (GBP-like).

import { computeUsdBalances, type MultiCurrencyExpense, type Rates } from './fx';

function randomMultiCurrencyTrip(rand: () => number): { ids: string[]; expenses: MultiCurrencyExpense[]; rates: Rates } {
  const { ids, expenses } = randomTrip(rand);
  const pool = ['USD', 'MXN', 'JPY', 'EUR', 'IDR'];
  const rates: Rates = {
    MXN: 50_000_000 + Math.floor(rand() * 20_000_000),
    JPY: 5_000_000 + Math.floor(rand() * 3_000_000),
    EUR: 1_000_000_000 + Math.floor(rand() * 200_000_000),
    IDR: 50_000 + Math.floor(rand() * 20_000),
  };
  return {
    ids, rates,
    expenses: expenses.map(e => ({
      payerId: e.payerId, amountMinor: e.amountCents, shares: e.shares,
      currency: pool[Math.floor(rand() * pool.length)],
    })),
  };
}

describe('multi-currency invariants (500 randomized trips)', () => {
  const trips = Array.from({ length: 500 }, (_, i) => randomMultiCurrencyTrip(prng(20_000 + i)));

  it('USD balances are integer cents and always sum to exactly zero', () => {
    for (const { ids, expenses, rates } of trips) {
      const bal = computeUsdBalances(ids, expenses, [], rates);
      expect(Object.values(bal).every(Number.isInteger)).toBe(true);
      expect(sum(Object.values(bal))).toBe(0);
    }
  });

  it('balances do not depend on the order expenses arrived in', () => {
    for (const { ids, expenses, rates } of trips.slice(0, 100)) {
      expect(computeUsdBalances(ids, [...expenses].reverse(), [], rates))
        .toEqual(computeUsdBalances(ids, expenses, [], rates));
    }
  });

  it('the settle-up loop still reaches all-zero in ≤ n-1 payments', () => {
    for (const { ids, expenses, rates } of trips.slice(0, 300)) {
      const settlements: SettlementInput[] = [];
      let remaining = simplifyDebts(computeUsdBalances(ids, expenses, settlements, rates));
      while (remaining.length > 0) {
        const t = remaining[0];
        settlements.push({ fromId: t.fromId, toId: t.toId, amountCents: t.amountCents });
        remaining = simplifyDebts(computeUsdBalances(ids, expenses, settlements, rates));
        expect(settlements.length).toBeLessThanOrEqual(ids.length);
      }
      expect(Object.values(computeUsdBalances(ids, expenses, settlements, rates)).every(v => v === 0)).toBe(true);
      expect(settlements.length).toBeLessThanOrEqual(Math.max(0, ids.length - 1));
    }
  });

  it('a rate change after some payments leaves a settleable true-up (decision 12)', () => {
    for (const { ids, expenses, rates } of trips.slice(0, 200)) {
      const settlements: SettlementInput[] = [];
      const first = simplifyDebts(computeUsdBalances(ids, expenses, settlements, rates))[0];
      if (!first) continue;
      settlements.push({ fromId: first.fromId, toId: first.toId, amountCents: first.amountCents });

      const moved: Rates = { ...rates, MXN: rates.MXN + 3_000_000, EUR: rates.EUR - 50_000_000 };
      const after = computeUsdBalances(ids, expenses, settlements, moved);
      expect(sum(Object.values(after))).toBe(0);        // the early payment is kept, not lost
      const applied = applyTransfers(after, simplifyDebts(after));
      expect(Object.values(applied).every(v => v === 0)).toBe(true);
    }
  });
});
