import { parseRateToNanos } from '../lib/amount';

// Pre-fills the rate field for the first expense in a new currency (feature
// 01, decision 6). Frankfurter serves European Central Bank reference rates:
// free, no key, CORS-enabled. Any failure returns null and the logger types
// the rate instead — this must never block saving an expense.
const FRANKFURTER = 'https://api.frankfurter.dev/v1/latest';
const TIMEOUT_MS = 5000;

/** USD per one unit of `currency`, as integer nanos, or null. */
export async function fetchUsdRate(currency: string): Promise<number | null> {
  if (currency === 'USD') return null;
  try {
    const res = await fetch(`${FRANKFURTER}?base=${encodeURIComponent(currency)}&symbols=USD`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json();
    const usd = body?.rates?.USD;
    // String() of a JSON number is its shortest exact decimal; parse that, not the float.
    return typeof usd === 'number' ? parseRateToNanos(String(usd)) : null;
  } catch {
    return null;
  }
}
