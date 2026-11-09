# Plan — 01 Multi-currency

## Context

GroupTab is USD-only; on the Mexico City trip, peso expenses had to be converted by
hand. `docs/features/01-multi-currency.md` now has 12 decisions and no open
questions: log each expense in its own currency, one shared rate per currency per
trip set at first use (pre-filled from Frankfurter, editable), any member can change
a rate and that clears everyone's all-in, balances converted once to USD with
largest-remainder rounding, settlements stay fixed USD. This plan implements that.
Linked from the feature doc; approved by the owner 2026-11-07.

**Two refinements found while reading the code** (recorded in decisions 8–9):

1. **Rates are stored as an integer, not a decimal.** An invariant eval forbids
   `numeric/decimal` anywhere in the schema (integer money everywhere). So a rate is
   `usd_nanos_per_unit bigint` — billionths of a dollar per one major unit
   (MXN 0.0586 → 58,600,000). That's exact for every supported currency, including
   IDR (~0.0000625 → 62,500), and keeps conversion pure integer math.
2. **Decimal places come from a hardcoded table, not the browser.** Stored amounts
   are minor units, so every device must agree on the exponent. `Intl` data varies
   by browser for a few currencies (IDR, HUF, ISK); a disagreement would make one
   phone read an amount 100× off. The supported list is fixed (~30), so the table
   is small; `Intl` is still used for the currency symbol only.

## Design in one paragraph

Keep `computeBalances` and `simplifyDebts` unchanged. Group expenses by currency,
run `computeBalances` once per currency (settlements join the USD group), convert
each non-USD balance map to USD cents in one step with BigInt + largest remainder,
add the maps, then `simplifyDebts` as today. Every screen that shows a balance calls
one new function instead of building inputs inline (Home, TripFeed, Settle do this
today, three copies). A USD-only trip takes the exact path it takes now.

## Phase 1 — Database (owner applies; verify before any client deploy)

`supabase/schema.sql` (canonical) + `supabase/migrations/2026-11-XX-multi-currency.sql`
(incremental, pasted by the owner, same style as `2026-07-14-add-participant.sql`):

- `expenses.currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$')`.
  Keep the `amount_cents` column names on `expenses`/`expense_shares` (renaming live
  columns is risk for no gain); a schema comment documents them as **minor units of
  `expenses.currency`**. `settlements.amount_cents` stays USD cents.
- `trip_rates (trip_id → trips on delete cascade, currency text check '^[A-Z]{3}$'
  and <> 'USD', usd_nanos_per_unit bigint not null check (> 0), set_by participant,
  set_at timestamptz, primary key (trip_id, currency))`. RLS on; member `select`
  policy only; **no insert/update/delete policies** — writes via RPCs only. Add to
  the realtime publication.
- `set_rate(p_trip_id, p_currency, p_usd_nanos)` — member + `trip_is_active` +
  shape checks; upsert; then `update participants set all_expenses_in = false where
  trip_id = p_trip_id` (decision 7, server-enforced).
- `add_expense` gains `p_currency text default 'USD'`, `p_usd_nanos bigint default
  null`. Non-USD with no rate row → `p_usd_nanos` required, inserted
  `on conflict do nothing` (two simultaneous first expenses can't clash); an existing
  rate is never overwritten by this path. Logger-only all-in reset unchanged.
- `update_expense` gains `p_currency text default null` (null = **keep current** —
  so a cached old client can't silently flip an MXN expense to USD) and
  `p_usd_nanos default null` (needed only when switching to a currency without a
  rate). Still resets no one.
- Signature change: `drop function` the old 5-arg versions, recreate, re-grant.
  Defaults mean an old cached PWA calling with five named args still works, so the
  order is: **migration → verify live → deploy client**.

Live evals (run after the owner applies):
- `scripts/rls-check.mjs` +2: bob cannot read alice's `trip_rates`; nobody can
  insert/update `trip_rates` directly.
- `scripts/rpc-contract-check.mjs`: first MXN expense without a rate is rejected;
  with one it's stored; a second MXN expense doesn't overwrite it; `set_rate`
  clears every participant's all-in; `set_rate` rejected on closed trips and for
  non-members; bad currency codes rejected; the **old 5-arg `add_expense` call still
  works**; `update_expense` without `p_currency` keeps the currency.

## Phase 2 — Pure libraries (tier-1 tests, offline)

- **New `src/lib/currency.ts`** — the supported list (Frankfurter's, confirmed by
  one live call at build time) with ISO 4217 exponents (JPY/KRW/ISK 0, others 2),
  `exponentOf(code)`, `isSupported(code)`.
- **New `src/lib/fx.ts`** — the only conversion code. BigInt throughout.
  - `toUsdCentsExact(minor, currency, nanos)` → numerator/denominator
    (`minor × nanos` over `10^(exp + 7)`; 1 cent = 10⁷ nanos).
  - `convertBalancesToUsd(balances, currency, nanos)` → floor each, hand the cents
    still needed to reach a zero sum to the largest remainders, ties by participant
    order (decision 9).
  - `computeUsdBalances(participantIds, expenses, settlements, rates)` — the
    orchestration above; reuses `computeBalances` from `src/lib/money.ts`.
  - `approxUsdCents(minor, currency, nanos)` — display only (the ≈ line, totals).
  - Converts back to `number` with a `Number.isSafeInteger` assertion.
- **`src/lib/amount.ts`** — add a `decimals` parameter (default 2, so existing
  callers and tests are untouched) to `sanitizeDecimalString`, `appendDigitOrDot`,
  `parseAmountStrToCents`→`parseAmountStrToMinor`, `centsToAmountStr`→
  `minorToAmountStr`; 0 decimals ignores '.'. Add `parseRateToNanos(str)` —
  string-digit parsing, no float, also used on the API's number via `String(n)`.
- **`src/lib/format.ts`** — `fmtMoney(minor, currency)` using the exponent table for
  the digits and `Intl` for the symbol ("MX$850.00", "¥1,200"). `fmtCents` stays.
- **`src/lib/types.ts`** — `Expense.amountCents` → **`amountMinor`** plus
  `currency`; `TripData.rates: Record<string, number>` (nanos as plain numbers so
  the localStorage cache can `JSON.stringify`; all values < 2⁵³). The rename is
  deliberate: the compiler then flags every place that sums expense amounts across
  currencies (e.g. Home's and Settle's `totalSpend`), which is exactly the bug class
  this feature introduces.

Tests: `fx.test.ts` (exact conversion, JPY 0-decimal, zero-sum after rounding,
tie-break order, USD-only ≡ `computeBalances`); `money.scenarios.test.ts` gains
randomized multi-currency trips (sum to 0 USD cents, settle loop still terminates
in ≤ n−1 payments); `amount.test.ts` (decimals 0/2, `parseRateToNanos` including
"0.0000625" and junk); `format.test.ts` (`fmtMoney`).

`evals/invariants.test.ts` updates (each is a real rule change, not a widening):
RLS on **seven** tables; realtime publishes/subscribes **six**; `set_rate` joins the
closed-trip RPC list; new check — `fx.ts` contains no `parseFloat|toFixed|
Math.round|Math.floor` (BigInt only); new check — `set_rate` resets all-in for the
whole trip; `trip_rates` has no write policies; the "no numeric/decimal" check stays
as is (the bigint design satisfies it).

## Phase 3 — Data layer

- `src/data/api.ts` — `fetchTripData` selects `currency` and `trip_rates`; mapping
  defaults a missing currency to `'USD'` and missing rates to `{}` so an **old
  offline cache still loads**. `addExpense`/`updateExpense` pass currency + first-use
  rate; new `setRate`.
- **New `src/data/rates.ts`** — `fetchUsdRate(code)`: one GET to Frankfurter
  (`/latest?base=MXN&symbols=USD`), 5 s timeout, returns nanos or `null` on any
  failure. Never throws into the UI; null means "type it".
- `src/data/useTripData.ts` — subscribe to `trip_rates` too.

## Phase 4 — Screens

- **AddExpense (`ExpenseForm`)** — currency chip beside the amount opening a picker
  (same pattern as "Paid by"). Default: currency of `data.expenses[0]` (newest
  first) or `'USD'`; edit uses the expense's own. Keypad and custom-split inputs use
  the currency's decimals; switching currency re-sanitizes typed values. If the
  currency has no trip rate: a "1 MXN = $___" row, pre-filled by `fetchUsdRate`,
  editable, required for Save. Existing ref lock + closed-trip guard unchanged.
  Suggestions untouched.
- **TripFeed / ExpenseDetail** — `fmtMoney` for the amount and shares, "≈ $49.80"
  beneath non-USD amounts (decision 11). Hero balance from `computeUsdBalances`.
- **Settle** — balances/transfers from `computeUsdBalances`. A "Rates" row per
  foreign currency: value, Edit → input → `setRate` with a synchronous ref lock held
  through `await refetch()`, toast on failure, a one-line note that changing a rate
  returns everyone to DRAFT. Hidden and handler-guarded when closed.
- **Home** — hero balance and "spent" via the new helpers (≈USD total).
- **CSV (`src/lib/csv.ts`)** — add `currency` and `usd_estimate` columns; amounts in
  the original currency; trailing `rate` rows (currency, USD per unit). Tests updated.

## Phase 5 — Flow eval, docs, ship

- New `e2e/multi-currency.spec.ts` — Frankfurter mocked with `page.route` (no
  network flake): log MXN expense → rate pre-filled → ≈USD in feed → Settle shows
  the rate → change it → transfers show DRAFT. Existing three specs pass unchanged.
- Ship per CLAUDE.md, in **one PR**: merge the spec delta into `docs/spec.md`,
  set the feature doc to Shipped, move the roadmap row to Shipped, update CLAUDE.md's
  "integer cents" invariant to "integer minor units; conversion only in `fx.ts`".
- Environment: allow Frankfurter's host for one real smoke fetch.

## Order of work and hand-offs

1. Phase 1 SQL → **you paste the migration** into the Supabase SQL editor → I run
   `npm run eval:live`.
2. Phases 2–4 on the working branch, `npm run eval` green at each step.
3. Phase 5, then the PR. Merging deploys.

## Verification

- `npm run eval` (tsc + all unit/scenario/invariant tests) and `npm run build`.
- `npm run eval:live` — RLS +2, contract checks above, including backward-compat
  of the old `add_expense` call.
- `npm run eval:e2e` — four specs at 390×844, with the preinstalled Chromium.
- Manual smoke against the dev server: real Frankfurter fetch for MXN and JPY,
  yen shows no decimals, a USD-only trip looks exactly as before.

## Risks

- **Rounding drift between ≈ and balances.** The per-expense ≈USD can differ from the
  balance math by a cent; the ≈ sign and decision 11 accept this.
- **Frankfurter changes host or list.** Only pre-fill breaks; typing still works.
- **A cached old client after deploy.** Covered by the defaults above; the contract
  check proves it.
- **Size.** ~15 files plus SQL. The phases are independently testable; the DB phase
  is safe to apply early because old clients are unaffected.
