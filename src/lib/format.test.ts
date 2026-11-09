import { describe, it, expect } from 'vitest';
import { fmtCents, fmtSigned } from './format';

describe('format', () => {
  it('formats cents as dollars', () => {
    expect(fmtCents(123456)).toBe('$1,234.56');
    expect(fmtCents(5)).toBe('$0.05');
    expect(fmtCents(0)).toBe('$0.00');
  });
  it('formats signed amounts', () => {
    expect(fmtSigned(8400)).toBe('+$84.00');
    expect(fmtSigned(-1250)).toBe('-$12.50');
    expect(fmtSigned(0)).toBe('$0.00');
  });
});

import { fmtMoney } from './format';

describe('fmtMoney (feature 01)', () => {
  it('matches fmtCents for USD', () => {
    for (const c of [123456, 5, 0, -1250]) expect(fmtMoney(c, 'USD')).toBe(fmtCents(c));
  });
  it('uses the currency symbol and its own decimals', () => {
    expect(fmtMoney(85_000, 'MXN')).toBe('MX$850.00');
    expect(fmtMoney(1_200, 'JPY')).toBe('¥1,200');
    expect(fmtMoney(123_456, 'EUR')).toBe('€1,234.56');
    expect(fmtMoney(-500, 'GBP')).toBe('-£5.00');
  });
  it('shows an unknown or malformed code plainly instead of crashing', () => {
    expect(fmtMoney(100, 'ZZZ')).toMatch(/^ZZZ\s?1\.00$/);
    expect(() => fmtMoney(100, 'not-a-code')).not.toThrow();
    expect(fmtMoney(100, 'not-a-code')).toBe('not-a-code 1.00');
  });
});
