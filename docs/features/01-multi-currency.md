# 01 — Multi-currency

**Status:** Designing — open questions below must be closed before planning.
**Roadmap:** #1 (R3 · I5 · C4 · E3 · score 20.0) — see [roadmap.md](../roadmap.md)
**Started:** 2026-11-07

## Problem

GroupTab is USD-only. On an international trip, the first expense — a dinner in
pesos — can't be logged without someone converting it by hand, at their own rate.
A recent Mexico City trip confirmed the demand. Competitors treat currencies as
basic: Tricount and Splid both support 150+ currencies; Splitwise puts conversion
behind its paid tier.

## Decisions

Decided 2026-11-07 by the owner, in review comments on the roadmap.

1. **Log each expense in the currency it was paid in.** No conversion at entry.
   The expense keeps its original amount and currency permanently.
2. **Convert once, at settle-up.** Balances are computed per currency, each in that
   currency's integer minor units, then converted to the settlement currency in a
   single step. Every expense in a currency converts at the same rate.
   *Why:* one conversion point means one rounding point, and per-currency balances
   stay exact until then.
3. **USD is the settlement currency.** Transfers are always shown and paid in USD.
4. **One rate per currency for the whole trip.** Everyone pays the same rate.
   Differences between individual card or cash rates are deliberately ignored.
5. **Entering an expense directly in USD is always allowed**, even on a foreign
   trip. *Accepted trade-off:* someone who converts at their own card's rate and
   logs USD bypasses the shared rate for that expense.

## Open questions

1. **Where does the settle-up rate come from?** Options: fetched from a public
   rate API in the browser (no backend exists — needs an allowed CORS endpoint),
   typed in by the trip creator, or fetched as a default the creator can override.
2. **Who can set or change the rate, and when does it lock?** Proposal: any member
   can set it while transfers are DRAFT; it locks when everyone is all-in (FINAL),
   and changing it afterwards resets all-in flags.
3. **Currencies without cents.** The Japanese yen has 0 decimal places; a few
   currencies have 3. Store minor-unit exponent per currency (ISO 4217) and format
   accordingly — confirm the supported currency list (all ISO 4217, or a short
   list to start).
4. **Rounding on conversion.** Converted per-currency balances must still sum to
   zero across the group in USD cents. Define the leftover-cent rule, consistent
   with the existing one (payer first, then first participant).
5. **Default currency per trip.** Should a trip have a "local currency" that new
   expenses default to (one tap fewer per entry), with USD one tap away?
6. **What the feed, Settle and CSV show.** Original amount only, original + USD
   estimate before the rate is set, or both after? CSV likely needs original
   amount, currency, rate and USD amount as separate columns.
7. **Settlements already recorded before conversion.** If someone pays a transfer
   while the rate is still DRAFT, how is that settlement stored and re-evaluated
   when the rate changes?

## Spec delta

*Draft — to be completed once the open questions are closed.* Sections of
[spec.md](../spec.md) that will change:

- **Non-Goals (v1):** remove "Multi-currency (USD only)".
- **Add expense:** a currency selector next to the amount.
- **Data model:** `expenses.currency` (ISO 4217 code); `expense_shares.amount_minor`
  in the expense's currency; a per-trip rate table (`trip_rates`: trip_id,
  currency, usd_per_unit, set_by, set_at).
- **Money rules:** balances computed per currency in integer minor units;
  conversion to USD cents at settle-up with a defined rounding rule; transfers in
  USD only.
- **Settle up:** rate display and setting; DRAFT/FINAL interaction with rate changes.
- **Export:** currency, rate and USD columns.

## Acceptance criteria

- An expense logged in MXN is stored and displayed in MXN, never converted at entry.
- With one rate set per currency, every member sees identical USD balances and
  transfers.
- Converted balances sum to exactly 0 USD cents across the group (unit-tested).
- A trip with only USD expenses behaves exactly as today (existing tests pass
  unchanged).
- No floating-point arithmetic anywhere in the money path, including conversion.
- Rate changes are visible to all members before transfers become FINAL.

## Implementation plan

*Not written yet.* Once the open questions are closed, write it in plan mode as
`docs/plans/01-multi-currency.md` and link it here. Must cover: the
`supabase/migrations/` snippet and the matching `schema.sql` change; `add_expense`
and `update_expense` RPC changes (and `scripts/rpc-contract-check.mjs`); `money.ts`
changes with new scenario tests (see [evals.md](../evals.md)); AddExpense — which
now also has description suggestions — Feed, Settle and CSV changes;
`scripts/rls-check.mjs` coverage for the new rate table.
