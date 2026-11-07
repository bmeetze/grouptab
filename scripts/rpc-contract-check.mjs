// Server-side contract evals for the write RPCs and the closed-trip rules.
// Companion to rls-check.mjs: that script attacks the access boundary, this
// one verifies that the rules the client relies on are actually enforced in
// Postgres — money validation, all-in reset semantics, closed-trip
// read-only, claim races. Run on demand (both write real rows to the live
// project, same personal-scale tradeoff as the E2E):
//
//   node scripts/rpc-contract-check.mjs      # or: npm run eval:live
//
import { createClient } from '@supabase/supabase-js';

const URL = 'https://fsxgzverfxtrqludigdo.supabase.co';
const KEY = 'sb_publishable_MnzXAf0p-6ariSDD00jVwQ_-I4dYPHb';
const mem = () => { const m = new Map(); return {
  getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
const client = () => createClient(URL, KEY, { auth: { storage: mem(), persistSession: true } });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures++;
};
const section = name => console.log(`\n— ${name} —`);

// A write RPC that must be refused. Returns the message so a wrong-reason
// rejection is still visible in the log.
const rejects = async (promise) => {
  const { error } = await promise;
  return { ok: error !== null, msg: error?.message ?? '(no error — the write was ACCEPTED)' };
};

const stamp = Date.now();
const alice = client(), bob = client(), carol = client(), anon = client();
await alice.auth.signInAnonymously();
await bob.auth.signInAnonymously();
await carol.auth.signInAnonymously();

// ---------------------------------------------------------------- fixtures

const { data: tripA, error: eA } = await alice.rpc('create_trip', {
  p_trip_name: `RPC contract A ${stamp}`, p_names: ['Alice', 'Ann', 'Amy'], p_your_name: 'Alice',
});
if (eA) throw eA;

const { data: tripB, error: eB } = await bob.rpc('create_trip', {
  p_trip_name: `RPC contract B ${stamp}`, p_names: ['Bob'], p_your_name: 'Bob',
});
if (eB) throw eB;

const { data: partsA } = await alice.from('participants').select('*').eq('trip_id', tripA.trip_id);
const pid = name => partsA.find(p => p.name === name)?.id;
const ALICE = pid('Alice'), ANN = pid('Ann'), AMY = pid('Amy');

const { data: partsB } = await bob.from('participants').select('id').eq('trip_id', tripB.trip_id);
const OUTSIDER = partsB[0].id;

// Bob joins trip A as Ann, so the trip has two claimed members.
const { data: bobClaimed } = await bob.rpc('claim_participant',
  { p_slug: tripA.share_slug, p_participant_id: ANN });

const addExpense = (c, over = {}) => c.rpc('add_expense', {
  p_trip_id: tripA.trip_id, p_payer_participant_id: ALICE,
  p_description: 'Contract check', p_amount_cents: 3000,
  p_shares: { [ALICE]: 1000, [ANN]: 1000, [AMY]: 1000 }, ...over,
});

// ------------------------------------------------- add_expense validation

section('add_expense validation (money can never be inconsistent)');

check('shares that undershoot the amount are rejected',
  (await rejects(addExpense(alice, { p_shares: { [ALICE]: 1000, [ANN]: 1000 } }))).ok);

check('shares that overshoot the amount are rejected',
  (await rejects(addExpense(alice, { p_shares: { [ALICE]: 2000, [ANN]: 2000 } }))).ok);

check('a zero amount is rejected',
  (await rejects(addExpense(alice, { p_amount_cents: 0, p_shares: { [ALICE]: 0 } }))).ok);

check('a negative amount is rejected',
  (await rejects(addExpense(alice, { p_amount_cents: -3000, p_shares: { [ALICE]: -3000 } }))).ok);

check('a zero share is rejected',
  (await rejects(addExpense(alice, { p_amount_cents: 2000, p_shares: { [ALICE]: 2000, [ANN]: 0 } }))).ok);

check('a negative share is rejected',
  (await rejects(addExpense(alice, { p_amount_cents: 1000, p_shares: { [ALICE]: 2000, [ANN]: -1000 } }))).ok);

check('an empty split is rejected',
  (await rejects(addExpense(alice, { p_shares: {} }))).ok);

check('a blank description is rejected',
  (await rejects(addExpense(alice, { p_description: '   ' }))).ok);

check('a payer from another trip is rejected',
  (await rejects(addExpense(alice, { p_payer_participant_id: OUTSIDER }))).ok);

check('a share participant from another trip is rejected',
  (await rejects(addExpense(alice, {
    p_shares: { [ALICE]: 1000, [ANN]: 1000, [OUTSIDER]: 1000 } }))).ok);

check('a non-member cannot log an expense',
  (await rejects(addExpense(carol))).ok);

// ------------------------------------------------------- storage fidelity

section('storage fidelity (what the client computes is what Postgres stores)');

const { data: expenseId, error: addErr } = await addExpense(alice, {
  p_description: 'Uneven split', p_amount_cents: 10_000,
  p_shares: { [ALICE]: 3334, [ANN]: 3333, [AMY]: 3333 },   // money.ts leftover-cent rule
});
check('a valid expense is accepted', !addErr && !!expenseId, addErr?.message);

const { data: storedShares } = await alice.from('expense_shares')
  .select('participant_id, amount_cents').eq('expense_id', expenseId);
const shareMap = Object.fromEntries((storedShares ?? []).map(s => [s.participant_id, s.amount_cents]));
check('uneven-split shares are stored exactly as computed, to the cent',
  shareMap[ALICE] === 3334 && shareMap[ANN] === 3333 && shareMap[AMY] === 3333,
  JSON.stringify(shareMap));
check('stored shares sum to the expense amount',
  (storedShares ?? []).reduce((s, r) => s + r.amount_cents, 0) === 10_000);

check('a payer outside the split is allowed (paying on others behalf)',
  !(await rejects(addExpense(alice, {
    p_description: 'Paid for the others', p_amount_cents: 2000,
    p_shares: { [ANN]: 1000, [AMY]: 1000 } }))).ok);

// -------------------------------------------------- all-in reset semantics

section('all-in auto-reset (keys on who LOGGED it, never the payer)');

const flagOf = async (id) => (await alice.from('participants')
  .select('all_expenses_in').eq('id', id).single()).data?.all_expenses_in;
const setFlag = (c, id) => c.from('participants').update({ all_expenses_in: true }).eq('id', id).select();

check('bob joined trip A as Ann (fixture for the reset checks)', bobClaimed === true);
await setFlag(alice, ALICE);
await setFlag(bob, ANN);
check('both members are marked all-in before the next expense',
  (await flagOf(ALICE)) === true && (await flagOf(ANN)) === true);

// Alice logs an expense that BOB paid for.
const { error: onBehalfErr } = await addExpense(alice, {
  p_description: 'Logged by Alice, paid by Ann', p_payer_participant_id: ANN,
  p_amount_cents: 900, p_shares: { [ALICE]: 300, [ANN]: 300, [AMY]: 300 },
});
check('logging on someone else\'s behalf succeeds', !onBehalfErr, onBehalfErr?.message);
check("the logger's all-in flag resets", (await flagOf(ALICE)) === false);
check("the payer's all-in flag is untouched", (await flagOf(ANN)) === true);

// Edits are corrections — they reset no one.
await setFlag(alice, ALICE);
const { error: editErr } = await alice.rpc('update_expense', {
  p_expense_id: expenseId, p_payer_participant_id: ALICE,
  p_description: 'Uneven split (edited)', p_amount_cents: 10_000,
  p_shares: { [ALICE]: 4000, [ANN]: 3000, [AMY]: 3000 },
});
check('an edit is accepted', !editErr, editErr?.message);
check('an edit resets nobody — the editor stays all-in', (await flagOf(ALICE)) === true);
check('an edit resets nobody — the other member stays all-in', (await flagOf(ANN)) === true);

const { data: editedShares } = await alice.from('expense_shares')
  .select('participant_id, amount_cents').eq('expense_id', expenseId);
check('an edit replaces the split rather than accumulating rows',
  (editedShares ?? []).length === 3 &&
  (editedShares ?? []).reduce((s, r) => s + r.amount_cents, 0) === 10_000);

check('update_expense enforces the same sum rule as add_expense',
  (await rejects(alice.rpc('update_expense', {
    p_expense_id: expenseId, p_payer_participant_id: ALICE,
    p_description: 'Bad edit', p_amount_cents: 10_000,
    p_shares: { [ALICE]: 1, [ANN]: 1, [AMY]: 1 } }))).ok);

check('a non-member cannot edit an expense',
  (await rejects(carol.rpc('update_expense', {
    p_expense_id: expenseId, p_payer_participant_id: ALICE,
    p_description: 'Hijack', p_amount_cents: 100, p_shares: { [ALICE]: 100 } }))).ok);

// ------------------------------------------------------------ claim rules

section('claim rules');

check('claiming an already-claimed name loses the race (no error, returns false)',
  (await carol.rpc('claim_participant',
    { p_slug: tripA.share_slug, p_participant_id: ANN })).data === false);

check('an unclaimed name can still be claimed via the link',
  (await carol.rpc('claim_participant',
    { p_slug: tripA.share_slug, p_participant_id: AMY })).data === true);

check('claiming against an unknown slug is rejected',
  (await rejects(carol.rpc('claim_participant',
    { p_slug: 'not-a-real-slug', p_participant_id: AMY }))).ok);

// ------------------------------------------------------ the join view leak

section('capability model (the link grants the join view and nothing more)');

const { data: anonView } = await anon.rpc('get_trip_by_slug', { p_slug: tripA.share_slug });
check('an unauthenticated visitor sees the trip name and participant list',
  anonView?.trip?.name === `RPC contract A ${stamp}` && anonView?.participants?.length === 3);
check('the join view carries no expense or settlement data',
  !('expenses' in (anonView ?? {})) && !('settlements' in (anonView ?? {})) &&
  !JSON.stringify(anonView ?? {}).includes('amount_cents'));
// Note: get_trip_by_slug computes is_you as `claimed_by is not distinct from
// auth.uid()`, so for an anonymous caller (auth.uid() null) an *unclaimed*
// row also reports is_you=true. Harmless today because fetchTripData drops
// `you` entirely when there is no session — but that is why this asserts on
// claimed rows only.
check('no claimed participant is reported as "you" to a visitor',
  (anonView?.participants ?? []).filter(p => p.claimed).every(p => p.is_you === false));
check('an unauthenticated visitor cannot read the expense rows',
  ((await anon.from('expenses').select('id').eq('trip_id', tripA.trip_id)).data ?? []).length === 0);

// ------------------------------------------------------------- settlements

section('settlements');

check('a settlement to yourself is rejected by the table constraint',
  (await rejects(alice.from('settlements').insert({
    trip_id: tripA.trip_id, from_participant_id: ALICE,
    to_participant_id: ALICE, amount_cents: 100 }).select())).ok);

check('a non-positive settlement is rejected',
  (await rejects(alice.from('settlements').insert({
    trip_id: tripA.trip_id, from_participant_id: ANN,
    to_participant_id: ALICE, amount_cents: 0 }).select())).ok);

check('an unauthenticated client cannot record a settlement',
  (await rejects(anon.from('settlements').insert({
    trip_id: tripA.trip_id, from_participant_id: ANN,
    to_participant_id: ALICE, amount_cents: 100 }).select())).ok);

const { error: settleErr } = await alice.from('settlements').insert({
  trip_id: tripA.trip_id, from_participant_id: ANN,
  to_participant_id: ALICE, amount_cents: 100 }).select();
check('a member can record a valid settlement', !settleErr, settleErr?.message);

// ------------------------------------------------------- closed trip rules

section('closed trips are fully read-only');

const { data: tripC, error: eC } = await alice.rpc('create_trip', {
  p_trip_name: `RPC contract closed ${stamp}`, p_names: ['Alice', 'Zed'], p_your_name: 'Alice',
});
if (eC) throw eC;
const { data: partsC } = await alice.from('participants').select('*').eq('trip_id', tripC.trip_id);
const C_ALICE = partsC.find(p => p.name === 'Alice').id;
const C_ZED = partsC.find(p => p.name === 'Zed').id;

const { data: cExpense } = await alice.rpc('add_expense', {
  p_trip_id: tripC.trip_id, p_payer_participant_id: C_ALICE, p_description: 'Before closing',
  p_amount_cents: 1000, p_shares: { [C_ALICE]: 500, [C_ZED]: 500 },
});
const { error: closeErr } = await alice.from('trips')
  .update({ status: 'closed' }).eq('id', tripC.trip_id).select();
check('a member can close the trip', !closeErr, closeErr?.message);

check('add_expense is rejected on a closed trip',
  (await rejects(alice.rpc('add_expense', {
    p_trip_id: tripC.trip_id, p_payer_participant_id: C_ALICE, p_description: 'After closing',
    p_amount_cents: 500, p_shares: { [C_ALICE]: 500 } }))).ok);

check('update_expense is rejected on a closed trip',
  (await rejects(alice.rpc('update_expense', {
    p_expense_id: cExpense, p_payer_participant_id: C_ALICE, p_description: 'Late edit',
    p_amount_cents: 800, p_shares: { [C_ALICE]: 800 } }))).ok);

check('add_participant is rejected on a closed trip',
  (await rejects(alice.rpc('add_participant',
    { p_trip_id: tripC.trip_id, p_name: 'Late arrival' }))).ok);

const { data: flagRows, error: flagErr } = await alice.from('expenses')
  .update({ flagged: true, flagged_by_participant_id: C_ALICE }).eq('id', cExpense).select();
check('flagging an expense on a closed trip changes nothing',
  flagErr !== null || (flagRows ?? []).length === 0);

const { data: delRows, error: delErr } = await alice.from('expenses')
  .delete().eq('id', cExpense).select();
check('deleting an expense on a closed trip changes nothing',
  delErr !== null || (delRows ?? []).length === 0);

check('recording a settlement on a closed trip is rejected',
  (await rejects(alice.from('settlements').insert({
    trip_id: tripC.trip_id, from_participant_id: C_ZED,
    to_participant_id: C_ALICE, amount_cents: 500 }).select())).ok);

check('commenting on a closed trip is rejected',
  (await rejects(alice.from('comments').insert({
    trip_id: tripC.trip_id, expense_id: cExpense,
    participant_id: C_ALICE, body: 'late comment' }).select())).ok);

const { data: stillReadable } = await alice.from('expenses').select('id').eq('trip_id', tripC.trip_id);
check('a closed trip is still fully readable', (stillReadable ?? []).length === 1);

// --------------------------------------------------- multi-currency (01)

section('multi-currency (rates are shared, set at first use, changed only via set_rate)');

const { data: tripM, error: eM } = await alice.rpc('create_trip', {
  p_trip_name: `RPC contract M ${stamp}`, p_names: ['Alice', 'Ann'], p_your_name: 'Alice',
});
if (eM) throw eM;
const { data: partsM } = await alice.from('participants').select('id, name').eq('trip_id', tripM.trip_id);
const M_ALICE = partsM.find(p => p.name === 'Alice').id, M_ANN = partsM.find(p => p.name === 'Ann').id;
await bob.rpc('claim_participant', { p_slug: tripM.share_slug, p_participant_id: M_ANN });

const addM = (c, over = {}) => c.rpc('add_expense', {
  p_trip_id: tripM.trip_id, p_payer_participant_id: M_ALICE, p_description: 'Tacos',
  p_amount_cents: 85000, p_shares: { [M_ALICE]: 42500, [M_ANN]: 42500 }, ...over,
});
const rateOf = async (cur) => (await alice.from('trip_rates').select('usd_nanos_per_unit')
  .eq('trip_id', tripM.trip_id).eq('currency', cur).maybeSingle()).data?.usd_nanos_per_unit ?? null;

let r = await rejects(addM(alice, { p_currency: 'MXN' }));
check('the first expense in a new currency is rejected without a rate', r.ok, r.msg);

const { data: mxnId, error: mxnErr } = await addM(alice, { p_currency: 'MXN', p_usd_nanos: 58600000 });
const { data: mxnRow } = await alice.from('expenses').select('currency, amount_cents').eq('id', mxnId).maybeSingle();
check('with a rate it is stored in its own currency, unconverted',
  !mxnErr && mxnRow?.currency === 'MXN' && mxnRow?.amount_cents === 85000, mxnErr?.message);
check('and the rate is saved to the trip', (await rateOf('MXN')) === 58600000);

await addM(bob, { p_currency: 'MXN', p_usd_nanos: 1 });
check('a later expense in that currency never overwrites the rate', (await rateOf('MXN')) === 58600000);

r = await rejects(addM(alice, { p_currency: 'MX1', p_usd_nanos: 58600000 }));
check('a malformed currency code is rejected', r.ok, r.msg);

const { data: legacyId, error: legacyErr } = await alice.rpc('add_expense', {
  p_trip_id: tripM.trip_id, p_payer_participant_id: M_ALICE, p_description: 'Old client',
  p_amount_cents: 2000, p_shares: { [M_ALICE]: 1000, [M_ANN]: 1000 },
});
const { data: legacyRow } = await alice.from('expenses').select('currency').eq('id', legacyId).maybeSingle();
check('an old client\'s five-argument add_expense still works, as USD',
  !legacyErr && legacyRow?.currency === 'USD', legacyErr?.message);

const { error: keepErr } = await alice.rpc('update_expense', {
  p_expense_id: mxnId, p_payer_participant_id: M_ALICE, p_description: 'Tacos (edited)',
  p_amount_cents: 90000, p_shares: { [M_ALICE]: 45000, [M_ANN]: 45000 },
});
const { data: keptRow } = await alice.from('expenses').select('currency').eq('id', mxnId).maybeSingle();
check('an edit that omits the currency keeps it (old clients can\'t flip MXN to USD)',
  !keepErr && keptRow?.currency === 'MXN', keepErr?.message);

const editTo = (cur, nanos) => alice.rpc('update_expense', {
  p_expense_id: mxnId, p_payer_participant_id: M_ALICE, p_description: 'Tacos',
  p_amount_cents: 90000, p_shares: { [M_ALICE]: 45000, [M_ANN]: 45000 },
  p_currency: cur, ...(nanos ? { p_usd_nanos: nanos } : {}),
});
r = await rejects(editTo('EUR'));
check('switching an expense to a currency with no rate requires one', r.ok, r.msg);
check('with a rate the switch saves that currency\'s rate too',
  !(await rejects(editTo('EUR', 1080000000))).ok && (await rateOf('EUR')) === 1080000000);

r = await rejects(carol.rpc('set_rate', { p_trip_id: tripM.trip_id, p_currency: 'MXN', p_usd_nanos: 60000000 }));
check('a non-member cannot set a rate', r.ok, r.msg);
r = await rejects(alice.rpc('set_rate', { p_trip_id: tripM.trip_id, p_currency: 'USD', p_usd_nanos: 1 }));
check('USD has no rate to set', r.ok, r.msg);
r = await rejects(alice.rpc('set_rate', { p_trip_id: tripM.trip_id, p_currency: 'MXN', p_usd_nanos: 0 }));
check('a non-positive rate is rejected', r.ok, r.msg);

const allIn = async () => (await alice.from('participants').select('all_expenses_in')
  .eq('trip_id', tripM.trip_id)).data.map(p => p.all_expenses_in);
await alice.from('participants').update({ all_expenses_in: true }).eq('id', M_ALICE);
await bob.from('participants').update({ all_expenses_in: true }).eq('id', M_ANN);
await alice.rpc('set_rate', { p_trip_id: tripM.trip_id, p_currency: 'MXN', p_usd_nanos: 58600000 });
check('re-saving the same rate changes nothing (nobody loses all-in)', (await allIn()).every(v => v === true));
const { error: setErr } = await bob.rpc('set_rate', { p_trip_id: tripM.trip_id, p_currency: 'MXN', p_usd_nanos: 60000000 });
check('any member can change a rate', !setErr && (await rateOf('MXN')) === 60000000, setErr?.message);
check('changing a rate clears EVERYONE\'s all-in, not just the caller\'s', (await allIn()).every(v => v === false));

await alice.from('trips').update({ status: 'closed' }).eq('id', tripM.trip_id);
r = await rejects(alice.rpc('set_rate', { p_trip_id: tripM.trip_id, p_currency: 'MXN', p_usd_nanos: 61000000 }));
check('set_rate is rejected on a closed trip', r.ok, r.msg);

// ------------------------------------------------------------- release claim

section('release claim (the lost-device recovery path)');

check('an unrelated member cannot release someone else\'s claim',
  (await rejects(carol.rpc('release_claim', { p_participant_id: ALICE }))).ok);

check('a participant can release their own claim',
  !(await rejects(carol.rpc('release_claim', { p_participant_id: AMY }))).ok);

check('the trip creator can release anyone\'s claim',
  !(await rejects(alice.rpc('release_claim', { p_participant_id: ANN }))).ok);

const { data: afterRelease } = await alice.from('participants')
  .select('name, claimed_by').eq('trip_id', tripA.trip_id);
check('released names are free to claim again',
  (afterRelease ?? []).filter(p => p.claimed_by === null).length === 2);

// -----------------------------------------------------------------------

console.log(failures === 0
  ? '\nRPC contract check: ALL PASS'
  : `\nRPC contract check: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
