import { describe, it, expect } from 'vitest';
import {
  applyKey, appendDigitOrDot, centsToAmountStr, formatAmountDisplay,
  parseAmountStrToCents, sanitizeDecimalString,
} from './amount';

// The amount keypad is the app's only writer of money values, so its
// string ⇄ cents boundary gets exhaustive treatment: every regression here
// is a wrong number in someone's balance.

const type = (keys: string) => [...keys].reduce((s, k) => applyKey(s, k), '');

describe('parseAmountStrToCents', () => {
  it('round-trips every cent value up to $1,000.00 exactly', () => {
    for (let cents = 0; cents <= 100_000; cents++) {
      expect(parseAmountStrToCents(centsToAmountStr(cents))).toBe(cents);
    }
  });

  it('round-trips sampled values across the full 7-digit keypad range', () => {
    for (let cents = 100_001; cents <= 9_999_999; cents += 997) {
      expect(parseAmountStrToCents(centsToAmountStr(cents))).toBe(cents);
    }
  });

  it('resolves binary-float traps to the cent a human typed', () => {
    // Each of these is a value where n * 100 is not exact in IEEE 754;
    // Math.round (not floor/trunc) is what makes them land correctly.
    const traps: [string, number][] = [
      ['4.35', 435], ['8.29', 829], ['1.15', 115], ['16.08', 1608],
      ['0.29', 29], ['1234.56', 123456], ['2.67', 267], ['70.55', 7055],
    ];
    for (const [str, cents] of traps) expect(parseAmountStrToCents(str)).toBe(cents);
  });

  it('always returns a non-negative safe integer, never NaN', () => {
    for (const s of ['', '.', '..', 'abc', '0', '0.', '.5', '00.50', '9999999']) {
      const c = parseAmountStrToCents(s);
      expect(Number.isSafeInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats a bare or empty decimal point as zero (save stays disabled)', () => {
    expect(parseAmountStrToCents('')).toBe(0);
    expect(parseAmountStrToCents('.')).toBe(0);
    expect(parseAmountStrToCents('0.00')).toBe(0);
  });
});

describe('keypad entry (applyKey / appendDigitOrDot)', () => {
  it('builds the common 3-tap amount', () => {
    expect(parseAmountStrToCents(type('90'))).toBe(9000);
    expect(parseAmountStrToCents(type('4835'))).toBe(483500);
  });

  it('leads a bare decimal point with a zero', () => {
    expect(type('.')).toBe('0.');
    expect(parseAmountStrToCents(type('.5'))).toBe(50);
  });

  it('allows only one decimal point', () => {
    expect(type('1.2.3')).toBe('1.23');
  });

  it('stops at two decimal places', () => {
    expect(type('12.3456')).toBe('12.34');
  });

  it('replaces a lone leading zero instead of building "05"', () => {
    expect(type('05')).toBe('5');
    expect(type('0')).toBe('0');
  });

  it('caps entry at 7 digits', () => {
    expect(type('123456789')).toBe('1234567');
    expect(type('12345.678')).toBe('12345.67');
  });

  it('backspaces one character at a time, including off the empty string', () => {
    expect(applyKey('12.50', '⌫')).toBe('12.5');
    expect(applyKey('1', '⌫')).toBe('');
    expect(applyKey('', '⌫')).toBe('');
  });

  it('never produces a string that parses to a negative or fractional cent', () => {
    // Fuzz the keypad the way a thumb would: deterministic PRNG, no Math.random.
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
    for (let round = 0; round < 2000; round++) {
      let s = '';
      const len = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < len; i++) s = applyKey(s, keys[Math.floor(rand() * keys.length)]);
      expect(s).toMatch(/^$|^\d{0,7}(\.\d{0,2})?$/);
      const cents = parseAmountStrToCents(s);
      expect(Number.isSafeInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThanOrEqual(0);
    }
  });

  it('appendDigitOrDot is what applyKey delegates to for non-backspace keys', () => {
    expect(applyKey('1', '2')).toBe(appendDigitOrDot('1', '2'));
  });
});

describe('sanitizeDecimalString (custom-split inputs)', () => {
  it('drops non-numeric characters', () => {
    expect(sanitizeDecimalString('$12.50abc')).toBe('12.50');
    expect(sanitizeDecimalString('-5')).toBe('5');   // no negative shares reach the RPC
  });
  it('keeps one point and at most two decimals', () => {
    expect(sanitizeDecimalString('1.2.3')).toBe('1.23');
    expect(sanitizeDecimalString('7.999')).toBe('7.99');
  });
  it('strips redundant leading zeros but keeps a lone zero', () => {
    expect(sanitizeDecimalString('007')).toBe('7');
    expect(sanitizeDecimalString('0')).toBe('0');
    expect(sanitizeDecimalString('0.50')).toBe('0.50');
  });
  it('is idempotent', () => {
    for (const s of ['$1,234.567', '00.1.2', 'abc', '.', '9.9']) {
      expect(sanitizeDecimalString(sanitizeDecimalString(s))).toBe(sanitizeDecimalString(s));
    }
  });
});

describe('formatAmountDisplay', () => {
  it('shows $0.00 before anything is typed', () => {
    expect(formatAmountDisplay('')).toBe('$0.00');
  });
  it('renders the string as typed, mid-entry', () => {
    expect(formatAmountDisplay('48')).toBe('$48');
    expect(formatAmountDisplay('48.')).toBe('$48.');
    expect(formatAmountDisplay('48.5')).toBe('$48.50');
    expect(formatAmountDisplay('.5')).toBe('$0.50');
  });
  it('never shows a value that disagrees with what will be saved', () => {
    for (let cents = 0; cents <= 20_000; cents += 1) {
      const str = centsToAmountStr(cents);
      const shown = formatAmountDisplay(str);
      expect(shown).toBe(`$${str}`);
      expect(parseAmountStrToCents(str)).toBe(cents);
    }
  });
});

// ---- multi-currency (feature 01): decimals per currency, rates as nanos ----
import {
  sanitizeDecimalString as sanitize, appendDigitOrDot as append, applyKey as key,
  parseAmountStrToMinor, minorToAmountStr, parseRateToNanos, nanosToRateString,
} from './amount';

describe('amount entry in a zero-decimal currency (JPY)', () => {
  it('the keypad ignores "." and allows no decimals', () => {
    expect(append('12', '.', 0)).toBe('12');
    expect(append('', '.', 0)).toBe('');
    expect(append('12', '3', 0)).toBe('123');
    expect(key('120', '⌫', 0)).toBe('12');
  });
  it('sanitizing drops any decimal part', () => {
    expect(sanitize('1,200.50', 0)).toBe('1200');
    expect(sanitize('007', 0)).toBe('7');
  });
  it('parses and prints whole units', () => {
    expect(parseAmountStrToMinor('1200', 0)).toBe(1200);
    expect(minorToAmountStr(1200, 0)).toBe('1200');
  });
  it('2-decimal defaults are unchanged', () => {
    expect(sanitize('12.345')).toBe('12.34');
    expect(parseAmountStrToMinor('48.5')).toBe(4850);
    expect(minorToAmountStr(4850)).toBe('48.50');
  });
});

describe('exchange rates as integer nanos', () => {
  it('parses typed and API rates exactly, with no float', () => {
    expect(parseRateToNanos('0.0586')).toBe(58_600_000);
    expect(parseRateToNanos('1.08')).toBe(1_080_000_000);
    expect(parseRateToNanos('0.0000625')).toBe(62_500);         // IDR
    expect(parseRateToNanos(String(0.05862))).toBe(58_620_000);  // API JSON number
    expect(parseRateToNanos(' .5 ')).toBe(500_000_000);
    expect(parseRateToNanos('2')).toBe(2_000_000_000);
  });
  it('rounds past 9 decimals half up', () => {
    expect(parseRateToNanos('0.0000000014')).toBe(1);
    expect(parseRateToNanos('0.0000000015')).toBe(2);
  });
  it('rejects junk, zero and forms it cannot parse exactly', () => {
    for (const bad of ['', '.', 'abc', '0', '0.000', '-1', '1e-7', '1.2.3', '$0.05']) {
      expect(parseRateToNanos(bad), bad).toBeNull();
    }
  });
  it('round-trips for display and editing', () => {
    for (const n of [58_600_000, 1_080_000_000, 62_500, 2_000_000_000, 1]) {
      expect(parseRateToNanos(nanosToRateString(n))).toBe(n);
    }
    expect(nanosToRateString(58_600_000)).toBe('0.0586');
    expect(nanosToRateString(2_000_000_000)).toBe('2');
  });
});
