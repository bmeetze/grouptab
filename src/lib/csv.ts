import type { TripData } from './types';

function esc(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}
const dollars = (cents: number) => (cents / 100).toFixed(2);
const day = (iso: string) => iso.slice(0, 10);

export function tripToCsv(data: TripData): string {
  const name = (id: string) => data.participants.find(p => p.id === id)?.name ?? '?';
  const rows: string[][] = [['type', 'date', 'description', 'payer_or_from', 'to', 'amount', 'split']];
  for (const e of [...data.expenses].reverse()) { // oldest first reads naturally in a spreadsheet
    const split = Object.entries(e.shares).map(([id, c]) => `${name(id)}: ${dollars(c)}`).join('; ');
    rows.push(['expense', day(e.createdAt), e.description, name(e.payerParticipantId), '', dollars(e.amountCents), split]);
  }
  for (const s of data.settlements) {
    rows.push(['settlement', day(s.createdAt), 'Payment', name(s.fromParticipantId), name(s.toParticipantId), dollars(s.amountCents), '']);
  }
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}
