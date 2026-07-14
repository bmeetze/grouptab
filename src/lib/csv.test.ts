import { describe, it, expect } from 'vitest';
import { tripToCsv } from './csv';
import type { TripData } from './types';

const data: TripData = {
  trip: { id: 't1', name: 'Tahoe, "2026"', shareSlug: 'x', status: 'active', creatorParticipantId: 'p1' },
  participants: [
    { id: 'p1', name: 'Brandon', claimed: true, isYou: true, allExpensesIn: false },
    { id: 'p2', name: 'Jake', claimed: true, isYou: false, allExpensesIn: false },
  ],
  expenses: [{
    id: 'e1', payerParticipantId: 'p1', description: 'Boat, deposit', amountCents: 10000,
    flagged: false, flaggedByParticipantId: null, createdAt: '2026-07-09T12:00:00Z',
    updatedAt: null, shares: { p1: 5000, p2: 5000 }, comments: [],
  }],
  settlements: [{ id: 's1', fromParticipantId: 'p2', toParticipantId: 'p1',
    amountCents: 5000, createdAt: '2026-07-10T12:00:00Z' }],
  you: null,
};

describe('tripToCsv', () => {
  const lines = tripToCsv(data).split('\r\n');
  it('has the header row', () => {
    expect(lines[0]).toBe('type,date,description,payer_or_from,to,amount,split');
  });
  it('escapes commas and quotes per RFC 4180', () => {
    expect(lines[1]).toBe('expense,2026-07-09,"Boat, deposit",Brandon,,100.00,Brandon: 50.00; Jake: 50.00');
  });
  it('includes settlements', () => {
    expect(lines[2]).toBe('settlement,2026-07-10,Payment,Jake,Brandon,50.00,');
  });
});
