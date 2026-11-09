import { exponentOf } from './currency';

export function fmtCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

export function fmtSigned(cents: number): string {
  if (cents === 0) return '$0.00';
  return cents > 0 ? `+${fmtCents(cents)}` : fmtCents(cents);
}

// Currency symbol from Intl ("MX$", "€", "¥"); digits from currency.ts so every
// device renders the same stored minor units the same way.
const symbols = new Map<string, string>();
export function currencySymbol(currency: string): string {
  let sym = symbols.get(currency);
  if (sym === undefined) {
    try {
      sym = new Intl.NumberFormat('en-US', { style: 'currency', currency })
        .formatToParts(0).find(p => p.type === 'currency')?.value ?? `${currency} `;
    } catch {
      sym = `${currency} `;   // malformed code from the server: show it plainly
    }
    symbols.set(currency, sym);
  }
  return sym;
}

const names = new Map<string, string>();
/** English name for the dropdown ("Mexican Peso"); the code itself if the
 *  browser has no name for it. */
export function currencyName(currency: string): string {
  let name = names.get(currency);
  if (name === undefined) {
    try {
      name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(currency) ?? currency;
    } catch {
      name = currency;
    }
    names.set(currency, name);
  }
  return name;
}

/** Minor units of `currency` for display: fmtMoney(85000, 'MXN') -> "MX$850.00",
 *  fmtMoney(1200, 'JPY') -> "¥1,200". fmtMoney(c, 'USD') === fmtCents(c). */
export function fmtMoney(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const unit = 10 ** exp;
  const major = Math.floor(abs / unit).toLocaleString('en-US');
  const frac = exp > 0 ? `.${String(abs % unit).padStart(exp, '0')}` : '';
  return `${sign}${currencySymbol(currency)}${major}${frac}`;
}
