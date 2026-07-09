import { describe, it, expect } from 'vitest';
import { computeEqualSplit, computeBalances, simplifyDebts } from './money';

const [A, B, C, D] = ['a', 'b', 'c', 'd'];

describe('computeEqualSplit', () => {
  it('splits evenly when divisible', () => {
    expect(computeEqualSplit(9000, [A, B, C], A)).toEqual({ a: 3000, b: 3000, c: 3000 });
  });
  it('gives leftover cents to the payer when payer is in the split', () => {
    expect(computeEqualSplit(10000, [A, B, C], B)).toEqual({ a: 3333, b: 3334, c: 3333 });
  });
  it('gives leftover to the first split participant when payer is excluded', () => {
    expect(computeEqualSplit(10000, [B, C, D], A)).toEqual({ b: 3334, c: 3333, d: 3333 });
  });
  it('handles a subset split of one', () => {
    expect(computeEqualSplit(500, [C], A)).toEqual({ c: 500 });
  });
  it('shares always sum exactly to the total', () => {
    for (let total = 1; total <= 1000; total += 7) {
      const split = computeEqualSplit(total, [A, B, C], A);
      expect(Object.values(split).reduce((s, v) => s + v, 0)).toBe(total);
    }
  });
  it('rejects non-positive and non-integer amounts and empty splits', () => {
    expect(() => computeEqualSplit(0, [A], A)).toThrow();
    expect(() => computeEqualSplit(100.5, [A], A)).toThrow();
    expect(() => computeEqualSplit(100, [], A)).toThrow();
  });
});

describe('computeBalances', () => {
  it('payer is owed, sharers owe', () => {
    const bal = computeBalances([A, B, C], [
      { payerId: A, amountCents: 9000, shares: { a: 3000, b: 3000, c: 3000 } },
    ], []);
    expect(bal).toEqual({ a: 6000, b: -3000, c: -3000 });
  });
  it('payer excluded from split is owed the full amount', () => {
    const bal = computeBalances([A, B], [
      { payerId: A, amountCents: 500, shares: { b: 500 } },
    ], []);
    expect(bal).toEqual({ a: 500, b: -500 });
  });
  it('settlement sent moves the sender toward zero (mark-paid clears debt)', () => {
    const bal = computeBalances([A, B], [
      { payerId: A, amountCents: 1000, shares: { a: 500, b: 500 } },
    ], [{ fromId: B, toId: A, amountCents: 500 }]);
    expect(bal).toEqual({ a: 0, b: 0 });
  });
  it('balances always sum to zero', () => {
    const bal = computeBalances([A, B, C], [
      { payerId: A, amountCents: 10000, shares: { a: 3334, b: 3333, c: 3333 } },
      { payerId: B, amountCents: 777, shares: { b: 259, c: 518 } },
    ], [{ fromId: C, toId: A, amountCents: 1000 }]);
    expect(Object.values(bal).reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe('simplifyDebts', () => {
  it('produces the single obvious transfer for two people', () => {
    expect(simplifyDebts({ a: 500, b: -500 })).toEqual([{ fromId: 'b', toId: 'a', amountCents: 500 }]);
  });
  it('returns no transfers when everyone is settled', () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
  });
  it('invariant: transfers fully settle all balances with at most n-1 transfers', () => {
    // deterministic pseudo-random cases (mulberry32) — no Math.random
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rand() * 6);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const bal: Record<string, number> = {};
      let sum = 0;
      for (let i = 0; i < n - 1; i++) {
        const v = Math.floor(rand() * 20001) - 10000;
        bal[ids[i]] = v; sum += v;
      }
      bal[ids[n - 1]] = -sum; // force zero-sum
      const transfers = simplifyDebts(bal);
      const nonZero = Object.values(bal).filter(v => v !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      const after = { ...bal };
      for (const t of transfers) {
        expect(t.amountCents).toBeGreaterThan(0);
        after[t.fromId] += t.amountCents;
        after[t.toId] -= t.amountCents;
      }
      for (const id of ids) expect(after[id]).toBe(0);
    }
  });
});
