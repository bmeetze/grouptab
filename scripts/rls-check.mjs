// Verifies one trip's client cannot read another trip's data. Run on demand:
//   node scripts/rls-check.mjs
import { createClient } from '@supabase/supabase-js';

const URL = 'https://fsxgzverfxtrqludigdo.supabase.co';
const KEY = 'sb_publishable_MnzXAf0p-6ariSDD00jVwQ_-I4dYPHb';
const mem = () => { const m = new Map(); return {
  getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
const client = () => createClient(URL, KEY, { auth: { storage: mem(), persistSession: true } });

let failures = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };

const alice = client(); const bob = client();
await alice.auth.signInAnonymously();
await bob.auth.signInAnonymously();

const { data: aTrip, error: e1 } = await alice.rpc('create_trip',
  { p_trip_name: 'RLS check A', p_names: ['Alice', 'Ann'], p_your_name: 'Alice' });
if (e1) throw e1;
const { data: bTrip, error: eB } = await bob.rpc('create_trip',
  { p_trip_name: 'RLS check B', p_names: ['Bob'], p_your_name: 'Bob' });
if (eB) throw eB;

const { data: bobTrips } = await bob.from('trips').select('id');
check('bob only sees his own trip', bobTrips.length === 1 && bobTrips[0].id === bTrip.trip_id);

const { data: bobSeesA } = await bob.from('participants').select('id').eq('trip_id', aTrip.trip_id);
check("bob cannot read alice's participants", (bobSeesA ?? []).length === 0);

const { error: insErr } = await bob.from('expenses').insert(
  { trip_id: bTrip.trip_id, payer_participant_id: '00000000-0000-0000-0000-000000000000',
    description: 'direct insert', amount_cents: 100 });
check('direct expense insert is denied (RPC-only)', insErr !== null);

const { data: joinView } = await bob.rpc('get_trip_by_slug', { p_slug: aTrip.share_slug });
check('link (slug) still grants the join view — capability model', joinView?.trip?.name === 'RLS check A');

const { error: addPartErr } = await bob.rpc('add_participant', { p_trip_id: aTrip.trip_id, p_name: 'Intruder' });
check("bob cannot add a participant to alice's trip", addPartErr !== null);

const { data: bobParts } = await bob.from('participants').select('id').eq('trip_id', bTrip.trip_id);
const { data: reparentData, error: reparentErr } = await bob.from('participants')
  .update({ trip_id: aTrip.trip_id }).eq('id', bobParts[0].id).select();
check("bob cannot re-parent his participant row into alice's trip",
  reparentErr !== null || (reparentData ?? []).length === 0);

const { data: creatorTakeoverData, error: creatorTakeoverErr } = await bob.from('trips')
  .update({ creator_participant_id: null }).eq('id', aTrip.trip_id).select();
check("bob cannot touch alice's trip row",
  creatorTakeoverErr !== null || (creatorTakeoverData ?? []).length === 0);

const { error: ownCreatorErr } = await bob.from('trips')
  .update({ creator_participant_id: bobParts[0].id }).eq('id', bTrip.trip_id).select();
check('bob cannot reassign creator on his own trip', ownCreatorErr !== null);

// ---- trip_rates (feature 01): member-read only, never written directly ----
const { data: aliceParts } = await alice.from('participants').select('id, name').eq('trip_id', aTrip.trip_id);
const ALICE = aliceParts.find(p => p.name === 'Alice').id;
const { error: mxnErr } = await alice.rpc('add_expense', {
  p_trip_id: aTrip.trip_id, p_payer_participant_id: ALICE, p_description: 'Tacos',
  p_amount_cents: 85000, p_shares: { [ALICE]: 85000 }, p_currency: 'MXN', p_usd_nanos: 58600000 });
if (mxnErr) throw mxnErr;

const { data: bobSeesRates } = await bob.from('trip_rates').select('currency').eq('trip_id', aTrip.trip_id);
check("bob cannot read alice's exchange rates", (bobSeesRates ?? []).length === 0);

const { error: rateInsErr } = await bob.from('trip_rates').insert(
  { trip_id: bTrip.trip_id, currency: 'EUR', usd_nanos_per_unit: 1 }).select();
const { data: rateUpdData, error: rateUpdErr } = await alice.from('trip_rates')
  .update({ usd_nanos_per_unit: 1 }).eq('trip_id', aTrip.trip_id).select();
check('rates cannot be written directly, even on your own trip (set_rate only)',
  rateInsErr !== null && (rateUpdErr !== null || (rateUpdData ?? []).length === 0));

console.log(failures === 0 ? '\nRLS check: ALL PASS' : `\nRLS check: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
