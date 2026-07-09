export interface ExpenseInput { payerId: string; amountCents: number; shares: Record<string, number>; }
export interface SettlementInput { fromId: string; toId: string; amountCents: number; }
export interface Transfer { fromId: string; toId: string; amountCents: number; }

export function computeEqualSplit(totalCents: number, participantIds: string[], payerId: string): Record<string, number> {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error('amount must be positive integer cents');
  if (participantIds.length === 0) throw new Error('split needs at least one participant');
  const n = participantIds.length;
  const base = Math.floor(totalCents / n);
  const leftover = totalCents - base * n;
  const split: Record<string, number> = {};
  for (const id of participantIds) split[id] = base;
  const luckyId = participantIds.includes(payerId) ? payerId : participantIds[0];
  split[luckyId] += leftover;
  return split;
}

export function computeBalances(
  participantIds: string[],
  expenses: ExpenseInput[],
  settlements: SettlementInput[],
): Record<string, number> {
  const bal: Record<string, number> = {};
  for (const id of participantIds) bal[id] = 0;
  for (const e of expenses) {
    bal[e.payerId] = (bal[e.payerId] ?? 0) + e.amountCents;
    for (const [id, cents] of Object.entries(e.shares)) bal[id] = (bal[id] ?? 0) - cents;
  }
  for (const s of settlements) {
    bal[s.fromId] = (bal[s.fromId] ?? 0) + s.amountCents; // sending moves you toward zero
    bal[s.toId] = (bal[s.toId] ?? 0) - s.amountCents;
  }
  return bal;
}

export function simplifyDebts(balances: Record<string, number>): Transfer[] {
  const creditors: { id: string; amt: number }[] = [];
  const debtors: { id: string; amt: number }[] = [];
  for (const [id, v] of Object.entries(balances)) {
    if (v > 0) creditors.push({ id, amt: v });
    else if (v < 0) debtors.push({ id, amt: -v });
  }
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const out: Transfer[] = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const t = Math.min(creditors[ci].amt, debtors[di].amt);
    out.push({ fromId: debtors[di].id, toId: creditors[ci].id, amountCents: t });
    creditors[ci].amt -= t;
    debtors[di].amt -= t;
    if (creditors[ci].amt === 0) ci++;
    if (debtors[di].amt === 0) di++;
  }
  return out;
}
