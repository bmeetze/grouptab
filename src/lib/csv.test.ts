import { describe, it, expect } from 'vitest';
import { tripToCsv } from './csv';
import type { TripData } from './types';

const data: TripData = {
  trip: { id: 't1', name: 'Tahoe, "2026"', shareSlug: 'x', status: 'active', creatorParticipantId: 'p1' },
  participants: [
    { id: 'p1', name: 'Brandon', claimed: true, isYou: true, allExpensesIn: false },
    { id: 'p2', name: 'Jake', claimed: true, isYou: false, allExpensesIn: false },
  ],
  expenses: [
    { // newest first, as fetchTripData returns them
      id: 'e2', payerParticipantId: 'p2', description: 'Tacos', currency: 'MXN', amountMinor: 85000,
      flagged: false, flaggedByParticipantId: null, createdAt: '2026-07-11T12:00:00Z',
      updatedAt: null, shares: { p1: 42500, p2: 42500 }, comments: [],
    },
    {
      id: 'e1', payerParticipantId: 'p1', description: 'Boat, deposit', currency: 'USD', amountMinor: 10000,
      flagged: false, flaggedByParticipantId: null, createdAt: '2026-07-09T12:00:00Z',
      updatedAt: null, shares: { p1: 5000, p2: 5000 }, comments: [],
    },
  ],
  settlements: [{ id: 's1', fromParticipantId: 'p2', toParticipantId: 'p1',
    amountCents: 5000, createdAt: '2026-07-10T12:00:00Z' }],
  rates: { MXN: 58_600_000 },
  you: null,
};

describe('tripToCsv', () => {
  const lines = tripToCsv(data).split('\r\n');
  it('has the header row', () => {
    expect(lines[0]).toBe('type,date,description,payer_or_from,to,amount,currency,usd_estimate,split');
  });
  it('escapes commas and quotes per RFC 4180', () => {
    expect(lines[1]).toBe('expense,2026-07-09,"Boat, deposit",Brandon,,100.00,USD,100.00,Brandon: 50.00; Jake: 50.00');
  });
  it('keeps a foreign expense in its own currency, with a USD estimate', () => {
    expect(lines[2]).toBe('expense,2026-07-11,Tacos,Jake,,850.00,MXN,49.81,Brandon: 425.00; Jake: 425.00');
  });
  it('includes settlements, always in USD', () => {
    expect(lines[3]).toBe('settlement,2026-07-10,Payment,Jake,Brandon,50.00,USD,50.00,');
  });
  it('records the trip exchange rates', () => {
    expect(lines[4]).toBe('rate,,USD per 1 MXN,,,0.0586,MXN,,');
  });
});
