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

const { data: bobParts } = await bob.from('participants').select('id').eq('trip_id', bTrip.trip_id);
const { data: reparentData, error: reparentErr } = await bob.from('participants')
  .update({ trip_id: aTrip.trip_id }).eq('id', bobParts[0].id).select();
check("bob cannot re-parent his participant row into alice's trip",
  reparentErr !== null || (reparentData ?? []).length === 0);

const { data: creatorTakeoverData, error: creatorTakeoverErr } = await bob.from('trips')
  .update({ creator_participant_id: null }).eq('id', aTrip.trip_id).select();
check("bob cannot touch alice's trip row",
  creatorTakeoverErr !== null || (creatorTakeoverData ?? []).length === 0);

console.log(failures === 0 ? '\nRLS check: ALL PASS' : `\nRLS check: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
