// The amount-entry boundary: typed strings ⇄ integer cents.
//
// This is the ONE place in the app where a float touches money —
// parseAmountStrToCents' parseFloat — and it exists only to convert a
// user-typed decimal string into the integer cents everything downstream
// uses. Keeping it in a single audited module (rather than inline in the
// Add-expense screen) is what lets evals/invariants.test.ts assert that no
// other file in src/ does float math on money.

// Strips a typed value down to at most one '.', at most 2 decimal digits,
// and no redundant leading zeros ("00" -> "0", "05" -> "5") — the same shape
// rules the amount field enforces (nextAmountStr builds on this).
//
// `decimals` is the currency's minor-unit exponent (currency.ts). It defaults
// to 2 so USD callers are unchanged; 0 (JPY, KRW, ISK) drops any '.' part.
export function sanitizeDecimalString(raw: string, decimals = 2): string {
  let v = raw.replace(/[^0-9.]/g, '');
  if (decimals === 0) v = v.split('.')[0];
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  const parts = v.split('.');
  const intPart = parts[0].replace(/^0+(?=\d)/, '');
  return parts.length === 1 ? intPart : `${intPart}.${parts[1].slice(0, decimals)}`;
}

// The amount field's onChange: turns whatever the system keyboard (or a
// paste) produced into the next amount string. Same shape rules the old
// in-app keypad enforced — one '.', at most `decimals` decimals, no "05",
// at most 7 digits — plus two things a real keyboard needs:
//   - a decimal comma becomes a point (iOS/Android decimal pads show ',' in
//     many locales); when a '.' is also present, commas are thousands
//     separators and are dropped (always, in a zero-decimal currency);
//   - a bare leading point gets its zero (".5" -> "0.5").
// An edit that would exceed 7 digits is refused: `prev` comes back unchanged.
export const MAX_AMOUNT_DIGITS = 7;

export function nextAmountStr(prev: string, raw: string, decimals = 2): string {
  const commasAreGrouping = decimals === 0 || raw.includes('.');
  const normalized = raw.replace(/,/g, commasAreGrouping ? '' : '.');
  let v = sanitizeDecimalString(normalized, decimals);
  if (v.startsWith('.')) v = `0${v}`;
  if (v.replace('.', '').length > MAX_AMOUNT_DIGITS) return prev;
  return v;
}

// The only places a string amount becomes integer minor units, and back.
export function parseAmountStrToMinor(amountStr: string, decimals = 2): number {
  const n = parseFloat(amountStr || '0');
  return Number.isFinite(n) ? Math.round(n * 10 ** decimals) : 0;
}

export function minorToAmountStr(minor: number, decimals = 2): string {
  return (minor / 10 ** decimals).toFixed(decimals);
}

// USD-named wrappers, kept for the existing callers and tests.
export function parseAmountStrToCents(amountStr: string): number {
  return parseAmountStrToMinor(amountStr, 2);
}

export function centsToAmountStr(cents: number): string {
  return minorToAmountStr(cents, 2);
}

// ---- exchange rates: "0.0586" (USD per one unit) <-> integer nanos ----
// Parsed digit by digit, never through a float, so "0.0000625" is exactly
// 62_500. Also used on the rate API's JSON number via String(n), which yields
// the shortest round-tripping decimal. More than 9 decimals rounds half up.

const NANO_DIGITS = 9;

export function parseRateToNanos(raw: string): number | null {
  const s = raw.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const frac = (m[2] ?? '').padEnd(NANO_DIGITS + 1, '0');
  let nanos = BigInt(m[1] || '0') * 10n ** BigInt(NANO_DIGITS) + BigInt(frac.slice(0, NANO_DIGITS));
  if (Number(frac[NANO_DIGITS]) >= 5) nanos += 1n;
  const n = Number(nanos);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

export function nanosToRateString(nanos: number): string {
  const whole = Math.floor(nanos / 1e9);
  const frac = String(nanos % 1e9).padStart(NANO_DIGITS, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}
