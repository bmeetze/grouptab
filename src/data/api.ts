import { supabase } from './supabase';
import { currentUid } from './session';
import type { Trip, Participant, Expense, Settlement, TripData, TripRates } from '../lib/types';

function req<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function createTrip(tripName: string, names: string[], yourName: string) {
  const data = req(await supabase.rpc('create_trip',
    { p_trip_name: tripName, p_names: names, p_your_name: yourName }));
  return { tripId: data.trip_id as string, shareSlug: data.share_slug as string };
}

export async function claimParticipant(slug: string, participantId: string): Promise<boolean> {
  return req(await supabase.rpc('claim_participant', { p_slug: slug, p_participant_id: participantId }));
}

const mapTrip = (t: any): Trip => ({
  id: t.id, name: t.name, shareSlug: t.share_slug, status: t.status,
  creatorParticipantId: t.creator_participant_id,
});

export async function getTripBySlug(slug: string) {
  const data = req(await supabase.rpc('get_trip_by_slug', { p_slug: slug }));
  if (!data) throw new Error('Trip not found');
  const participants: Participant[] = data.participants.map((p: any) => ({
    id: p.id, name: p.name, claimed: p.claimed, isYou: p.is_you, allExpensesIn: p.all_expenses_in,
  }));
  return { trip: mapTrip(data.trip), participants };
}

export async function fetchTripData(slug: string): Promise<TripData> {
  const { trip, participants } = await getTripBySlug(slug);
  const uid = await currentUid();
  const you = participants.find(p => p.isYou) ?? null;
  if (!uid || !you) return { trip, participants, expenses: [], settlements: [], rates: {}, you: null };
  const [expRows, settleRows, rateRows] = await Promise.all([
    req(await supabase.from('expenses')
      .select('*, expense_shares(participant_id, amount_cents), comments(id, participant_id, body, created_at)')
      .eq('trip_id', trip.id).order('created_at', { ascending: false })),
    req(await supabase.from('settlements').select('*')
      .eq('trip_id', trip.id).order('created_at', { ascending: true })),
    req(await supabase.from('trip_rates').select('currency, usd_nanos_per_unit').eq('trip_id', trip.id)),
  ]);
  const expenses: Expense[] = (expRows as any[]).map(e => ({
    id: e.id, payerParticipantId: e.payer_participant_id, description: e.description,
    currency: e.currency ?? 'USD', amountMinor: e.amount_cents, flagged: e.flagged,
    flaggedByParticipantId: e.flagged_by_participant_id,
    createdAt: e.created_at, updatedAt: e.updated_at,
    shares: Object.fromEntries(e.expense_shares.map((s: any) => [s.participant_id, s.amount_cents])),
    comments: e.comments
      .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
      .map((c: any) => ({ id: c.id, participantId: c.participant_id, body: c.body, createdAt: c.created_at })),
  }));
  const settlements: Settlement[] = (settleRows as any[]).map(s => ({
    id: s.id, fromParticipantId: s.from_participant_id, toParticipantId: s.to_participant_id,
    amountCents: s.amount_cents, createdAt: s.created_at,
  }));
  const rates: TripRates = Object.fromEntries(
    (rateRows as any[]).map(r => [r.currency, Number(r.usd_nanos_per_unit)]));
  return { trip, participants, expenses, settlements, rates, you };
}

/** Fills fields added after a cache was written (multi-currency added
 *  `currency`, `amountMinor` and `rates`), so an offline cache from an older
 *  app version still renders — as the all-USD trip it was. */
export function normalizeTripData(raw: any): TripData {
  return {
    ...raw,
    rates: raw.rates ?? {},
    expenses: (raw.expenses ?? []).map((e: any) => ({
      ...e, currency: e.currency ?? 'USD', amountMinor: e.amountMinor ?? e.amountCents,
    })),
  };
}

// amountMinor/shares are minor units of `currency`. usdNanos is sent only for
// the first expense in a currency (the server saves it as the trip rate).
export async function addExpense(a: { tripId: string; payerParticipantId: string;
  description: string; currency: string; amountMinor: number; shares: Record<string, number>;
  usdNanos?: number | null }): Promise<string> {
  return req(await supabase.rpc('add_expense', {
    p_trip_id: a.tripId, p_payer_participant_id: a.payerParticipantId,
    p_description: a.description, p_amount_cents: a.amountMinor, p_shares: a.shares,
    p_currency: a.currency, p_usd_nanos: a.usdNanos ?? null,
  }));
}

export async function updateExpense(a: { expenseId: string; payerParticipantId: string;
  description: string; currency: string; amountMinor: number; shares: Record<string, number>;
  usdNanos?: number | null }): Promise<void> {
  req(await supabase.rpc('update_expense', {
    p_expense_id: a.expenseId, p_payer_participant_id: a.payerParticipantId,
    p_description: a.description, p_amount_cents: a.amountMinor, p_shares: a.shares,
    p_currency: a.currency, p_usd_nanos: a.usdNanos ?? null,
  }));
}

// Any member, open trips only; an actual change clears everyone's all-in
// (server-enforced, feature 01 decision 7).
export async function setRate(tripId: string, currency: string, usdNanos: number): Promise<void> {
  req(await supabase.rpc('set_rate', { p_trip_id: tripId, p_currency: currency, p_usd_nanos: usdNanos }));
}

export async function deleteExpense(expenseId: string): Promise<void> {
  req(await supabase.from('expenses').delete().eq('id', expenseId));
}

export async function setAllIn(participantId: string, value: boolean): Promise<void> {
  req(await supabase.from('participants').update({ all_expenses_in: value }).eq('id', participantId).select());
}

export async function setFlag(expenseId: string, flaggedByParticipantId: string | null): Promise<void> {
  req(await supabase.from('expenses')
    .update({ flagged: flaggedByParticipantId !== null, flagged_by_participant_id: flaggedByParticipantId })
    .eq('id', expenseId).select());
}

export async function addComment(tripId: string, expenseId: string, participantId: string, body: string): Promise<void> {
  req(await supabase.from('comments').insert({
    trip_id: tripId, expense_id: expenseId, participant_id: participantId, body,
  }).select());
}

export async function markPaid(tripId: string, fromId: string, toId: string, amountCents: number): Promise<void> {
  req(await supabase.from('settlements').insert({
    trip_id: tripId, from_participant_id: fromId, to_participant_id: toId, amount_cents: amountCents,
  }).select());
}

export async function closeTrip(tripId: string): Promise<void> {
  req(await supabase.from('trips').update({ status: 'closed' }).eq('id', tripId).select());
}

export async function releaseClaim(participantId: string): Promise<void> {
  req(await supabase.rpc('release_claim', { p_participant_id: participantId }));
}

export async function addParticipant(tripId: string, name: string): Promise<string> {
  return req(await supabase.rpc('add_participant', { p_trip_id: tripId, p_name: name }));
}

export async function fetchMyTrips(): Promise<{ trip: Trip; data: TripData }[]> {
  const uid = await currentUid();
  if (!uid) return [];
  const trips = req(await supabase.from('trips').select('*').order('created_at', { ascending: false }));
  const out: { trip: Trip; data: TripData }[] = [];
  for (const t of trips as any[]) {
    out.push({ trip: mapTrip(t), data: await fetchTripData(t.share_slug) });
  }
  return out;
}
