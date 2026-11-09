# 01 — Multi-currency

**Status:** Shipped 2026-11-09 — behavior now in [spec.md](../spec.md). Plan: [plans/01-multi-currency.md](../plans/01-multi-currency.md).
**Roadmap:** #1 (R3 · I5 · C4 · E3 · score 20.0) — see [roadmap.md](../roadmap.md)
**Started:** 2026-11-07

## Problem

GroupTab is USD-only. On an international trip, the first expense — a dinner in
pesos — can't be logged without someone converting it by hand, at their own rate.
A recent Mexico City trip confirmed the demand. Competitors treat currencies as
basic: Tricount and Splid both support 150+ currencies; Splitwise puts conversion
behind its paid tier.

## Decisions

Decisions 1–5 decided 2026-11-07 by the owner, in review comments on the roadmap.

1. **Log each expense in the currency it was paid in.** No conversion at entry.
   The expense keeps its original amount and currency permanently.
2. **Convert once, at settle-up.** Balances are computed per currency, each in that
   currency's integer minor units, then converted to the settlement currency in a
   single step. Every expense in a currency converts at the same rate.
   *Why:* one conversion point means one rounding point, and per-currency balances
   stay exact until then. ("At settle-up" means at the balance step, never at
   entry — see 6: a rate exists from first use, so USD balances are always shown.)
3. **USD is the settlement currency.** Transfers are always shown and paid in USD.
4. **One rate per currency for the whole trip.** Everyone pays the same rate.
   Differences between individual card or cash rates are deliberately ignored.
5. **Entering an expense directly in USD is always allowed**, even on a foreign
   trip. *Accepted trade-off:* someone who converts at their own card's rate and
   logs USD bypasses the shared rate for that expense.

Decisions 6–12 closed the open questions, 2026-11-07 (owner for 6, 7, 10, 11;
owner accepted the recommendation for 8, 9, 12).

6. **A currency gets its rate when it is first used.** The first expense in a
   currency saves that currency's trip rate in the same `add_expense` call, so a
   currency with expenses never lacks a rate. The rate field is pre-filled from a
   free public API (Frankfurter — European Central Bank reference rates; no key,
   browser-callable) and editable; if the fetch fails, the logger types it.
   *Why:* a "no rate yet" state would need its own UI on every money screen and
   would block mid-trip "Mark paid". Rate-at-first-use removes that state; the
   fetch only pre-fills a field that must exist anyway, at $0. *Fallback if the
   API proves unreliable:* drop the fetch and keep the typed field — nothing else
   changes.
7. **Anyone can change a rate while the trip is open; a change clears everyone's
   all-in.** Enforced server-side in a `set_rate` RPC (like `add_expense`'s reset),
   so transfers return to DRAFT and the group re-confirms. Rejected on closed trips.
8. **Supported currencies are the rate source's list** (~30 ECB currencies:
   MXN, EUR, GBP, JPY, CAD and other majors) plus USD. Decimal places per currency
   come from a hardcoded ISO 4217 table (JPY/KRW/ISK 0, the rest 2), not the
   browser: stored amounts are minor units, so every device must agree, and `Intl`
   data differs between browsers for a few currencies. `Intl` supplies the symbol
   only. The database stores integer minor units and never needs the exponent.
   *Accepted trade-off:* less-common currencies (e.g. VND, PEN) aren't offered until
   the rate source changes.
9. **Conversion rounding: largest remainder, per person per currency.** Each
   person's balance in a currency is converted exactly (integer math; the rate is
   stored as an integer — billionths of a USD per major unit, `bigint` — because the
   schema allows no decimal types; MXN 0.0586 → 58,600,000),
   floored to the cent, and the cents still needed for the group to sum to exactly
   $0.00 go to the largest remainders, ties broken by participant order. USD
   balances need no conversion. This is the balance-level analog of the existing
   leftover-cent rule (a balance has no payer to give the cent to).
10. **A new expense defaults to the currency of the trip's most recent expense.**
    No trip setting. USD is one tap away. A brand-new trip starts in USD.
11. **Foreign expenses show the original amount with ≈USD beneath** ("MX$850",
    "≈ $49.80") in the feed and on expense detail. The ≈ marks a display estimate
    that moves with the rate and can differ from the balance math by a cent.
    Balance hero, Settle and transfers are USD only.
12. **Settlements stay fixed USD amounts, whenever recorded.** If a rate changes
    after someone paid, the remaining transfers recompute and any true-up appears
    as a new transfer — the same thing that happens today when an expense is added
    after a mid-trip payment.

## Open questions

None. (Closed 2026-11-07 — see decisions 6–12.)

## Spec delta

*Draft — finalized in the implementation plan.* Changes to [spec.md](../spec.md):

- **Non-Goals:** remove "Multi-currency (USD only)".
- **Add expense:** a currency selector beside the amount, defaulting to the most
  recent expense's currency. The keypad's decimal places follow the currency. The
  first expense in a new currency shows a rate field ("1 MXN = $___"), pre-filled
  from the rate source and editable.
- **Trip screen / expense detail:** foreign amounts as original plus ≈USD.
- **Settle up:** a rates row listing each foreign currency's rate, editable by any
  member while the trip is open; changing one clears everyone's all-in. Balances
  and transfers in USD.
- **Data model:** `expenses.currency` (ISO 4217, default `'USD'`), amounts and
  shares in that currency's minor units (the existing `amount_cents` columns,
  renamed or documented as minor units); `trip_rates` (trip_id, currency,
  usd_nanos_per_unit bigint, set_by, set_at; one row per trip and currency;
  RPC-only writes; in the realtime publication).
- **Money rules:** balances per currency in integer minor units; conversion to USD
  cents by decision 9; settlements in USD; transfers in USD.
- **Export:** each expense's original amount and currency, plus a rates section.

## Acceptance criteria

- An expense logged in MXN is stored and displayed in MXN, never converted at entry.
- The first MXN expense cannot be saved without an MXN rate; later MXN expenses
  don't ask again.
- With one rate set per currency, every member sees identical USD balances and
  transfers.
- Converted balances sum to exactly 0 USD cents across the group (unit-tested,
  including JPY's 0-decimal case and randomized trips in `money.scenarios.test.ts`).
- Changing a rate clears every participant's all-in (live contract check).
- A trip with only USD expenses behaves exactly as today (existing tests pass
  unchanged).
- No floating-point arithmetic anywhere in the money path, including conversion
  (extend the invariant eval).
- Rate changes are visible to all members (realtime) before transfers become FINAL.

## Implementation plan

[plans/01-multi-currency.md](../plans/01-multi-currency.md) — approved 2026-11-07.
It covers: the `supabase/migrations/` snippet and the matching
`schema.sql` change (`expenses.currency`, `trip_rates`, `set_rate`, `add_expense`
taking currency and a first-use rate); `update_expense` (changing an expense's
currency to one without a rate); `scripts/rpc-contract-check.mjs` and
`scripts/rls-check.mjs` coverage for `trip_rates`; `money.ts` conversion with
scenario tests (see [evals.md](../evals.md)); the rate fetch and its failure path;
AddExpense (which now also has description suggestions), Feed, ExpenseDetail,
Settle and CSV changes; the network allowance for the rate API host.
