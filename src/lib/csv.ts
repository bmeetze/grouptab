import type { TripData } from './types';
import { exponentOf } from './currency';
import { approxUsdCents } from './fx';
import { nanosToRateString } from './amount';

function esc(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}
/** Minor units of `currency` as a plain decimal string: 85000 MXN -> "850.00", 1200 JPY -> "1200". */
const plain = (minor: number, currency = 'USD') => {
  const exp = exponentOf(currency);
  return exp === 0 ? String(minor) : (minor / 10 ** exp).toFixed(exp);
};
const day = (iso: string) => iso.slice(0, 10);

// Columns: amounts are in each row's own currency; usd_estimate is the
// display estimate (balances convert per person, so it can differ by a cent).
// Trailing `rate` rows record the trip's exchange rates (USD per one unit).
export function tripToCsv(data: TripData): string {
  const name = (id: string) => data.participants.find(p => p.id === id)?.name ?? '?';
  const rows: string[][] = [['type', 'date', 'description', 'payer_or_from', 'to', 'amount', 'currency', 'usd_estimate', 'split']];
  for (const e of [...data.expenses].reverse()) { // oldest first reads naturally in a spreadsheet
    const split = Object.entries(e.shares).map(([id, m]) => `${name(id)}: ${plain(m, e.currency)}`).join('; ');
    const usd = approxUsdCents(e.amountMinor, e.currency, data.rates);
    rows.push(['expense', day(e.createdAt), e.description, name(e.payerParticipantId), '',
      plain(e.amountMinor, e.currency), e.currency, usd === null ? '' : plain(usd), split]);
  }
  for (const s of data.settlements) {
    rows.push(['settlement', day(s.createdAt), 'Payment', name(s.fromParticipantId), name(s.toParticipantId),
      plain(s.amountCents), 'USD', plain(s.amountCents), '']);
  }
  for (const [currency, nanos] of Object.entries(data.rates).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push(['rate', '', `USD per 1 ${currency}`, '', '', nanosToRateString(nanos), currency, '', '']);
  }
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}
