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
// rules the on-screen/physical keypad enforces for the amount.
export function sanitizeDecimalString(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  const parts = v.split('.');
  const intPart = parts[0].replace(/^0+(?=\d)/, '');
  return parts.length === 1 ? intPart : `${intPart}.${parts[1].slice(0, 2)}`;
}

// Ported from the prototype's tapKey: one '.' max, ≤2 decimals, replaces a
// lone leading '0' rather than building "05", caps total digits at 7.
export function appendDigitOrDot(amountStr: string, k: string): string {
  if (k === '.') return amountStr.includes('.') ? amountStr : `${amountStr || '0'}.`;
  const dec = amountStr.split('.')[1];
  if (dec !== undefined && dec.length >= 2) return amountStr;
  if (amountStr.replace('.', '').length >= 7) return amountStr;
  return amountStr === '0' ? k : amountStr + k;
}

export function applyKey(amountStr: string, k: string): string {
  return k === '⌫' ? amountStr.slice(0, -1) : appendDigitOrDot(amountStr, k);
}

// '' -> $0.00; otherwise renders the string as-typed, padding the decimal
// part to 2 digits once a '.' is present ("48.5" -> "$48.50").
export function formatAmountDisplay(amountStr: string): string {
  if (!amountStr) return '$0.00';
  if (amountStr.endsWith('.')) return `$${amountStr}`;
  const [intPart, decPart] = amountStr.split('.');
  const dollars = intPart === '' ? '0' : intPart;
  return decPart === undefined ? `$${dollars}` : `$${dollars}.${decPart.padEnd(2, '0')}`;
}

// The only two places a string amount becomes integer cents.
export function parseAmountStrToCents(amountStr: string): number {
  const n = parseFloat(amountStr || '0');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToAmountStr(cents: number): string {
  return (cents / 100).toFixed(2);
}
