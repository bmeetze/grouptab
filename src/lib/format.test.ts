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
