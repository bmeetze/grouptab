# GroupTab evals

The standing correctness suite. GroupTab holds money: a wrong number here
does not throw an exception, it quietly tells someone they owe $45 when they
owe $54. These evals exist so that never ships.

Three tiers, by what they need to run:

| Tier | Command | Needs | Runs |
|------|---------|-------|------|
| **1 — Offline** | `npm run eval` | nothing | every push (CI gate) + before every commit |
| **2 — Live database** | `npm run eval:live` | network + the Supabase project | after any schema, RLS, RPC or `src/data/` change |
| **3 — Flows** | `npm run eval:e2e` | network + a local dev server | after any user-flow or screen change |

`npm run eval` is the gate: `tsc -b` plus the whole vitest suite. CI runs it
before it builds, so a red eval never reaches Pages. Tiers 2 and 3 write real
rows to the live project and stay local by design (see [Costs](#costs)).

---

## Tier 1 — offline evals (`npm run eval`)

No database, no browser, ~2 seconds. This is the tier that should always pass,
on any machine, at any time.

### Money math — `src/lib/money.test.ts`, `src/lib/money.scenarios.test.ts`

`money.ts` is the correctness core: every displayed number derives from
`computeEqualSplit`, `computeBalances` and `simplifyDebts`. The unit tests
cover each function; the scenario file evaluates them the way the app composes
them — whole trips in, a settle-up sequence out — and asserts four properties
over 500 randomized trips (deterministic PRNG, so a failure always reproduces):

1. **Conservation** — balances always sum to zero; transfers move exactly the
   amount owed; adding then deleting an expense returns balances to the cent.
2. **Exactness** — every share, balance and transfer is a positive safe
   integer; recorded splits sum exactly to their expense amount.
3. **Termination** — repeatedly paying the top suggested transfer (exactly what
   "Mark paid" does) reaches all-zero in at most n−1 payments, with strictly
   decreasing outstanding debt each round. This is the closest thing in tier 1
   to a live test of the Settle screen.
4. **Path independence** — balances do not depend on the order expenses
   arrived in.

Golden scenarios pin the spec's own examples: the $100/3-way 3334-3333-3333
split, leftover cents to the payer (or the first split participant when the
payer is excluded), and a hand-checked three-person weekend trip.

### Amount entry — `src/lib/amount.test.ts`

`src/lib/amount.ts` is the **only** place a float touches money: the keypad
produces a typed string, and `parseAmountStrToCents` converts it. The evals
round-trip every cent value up to $1,000.00 exactly, sample the rest of the
7-digit keypad range, pin the binary-float traps (`4.35 → 435`, not 434), and
fuzz 2,000 random keypad sequences to prove no reachable input yields a
negative or fractional cent.

### Formatting and export — `src/lib/format.test.ts`, `src/lib/csv.test.ts`

Display formatting and RFC 4180 CSV escaping. The CSV doubles as the backup
story (the Supabase free tier has no automatic backups), so its shape matters.

### Repo invariants — `evals/invariants.test.ts`

The rules in [CLAUDE.md](../CLAUDE.md), made executable. Unit tests prove the
code we have is right; these prove nobody removed a guard rail. Every check
encodes a bug found during the build:

- **Integer cents everywhere** — no float money math outside the three
  parsing/formatting files; the core does no rounding or parsing; no decimal
  column types; balances are never persisted.
- **Write surfaces** — expenses are inserted only via `add_expense` /
  `update_expense`; `expense_shares` is never written from the client; direct
  expense updates touch only the flag columns; screens never reach past
  `src/data/api.ts` to the Supabase client.
- **Re-entrancy locks** — every screen calling a non-idempotent write declares
  a guarded `useRef(false)` lock, and no lock is released on the success path
  inside its `try` (that re-opens the double-fire window).
- **Closed trips** — every write RPC and every insert/update/delete policy
  checks `trip_is_active`; screens guard the handler, not just the button.
- **Database access model** — RLS on all six tables; table-level `UPDATE`
  revoked and re-granted column by column; no INSERT policy on expenses or
  shares; only `get_trip_by_slug` / `keepalive` (plus the two policy helpers)
  are anon-callable; every RPC is `security definer` with a pinned
  `search_path`; the all-in reset keys on `v_me`, never the payer.
- **Three-place config** — the Supabase URL and publishable key agree across
  `src/lib/config.ts`, `scripts/rls-check.mjs` and `keepalive.yml`; no
  service-role key is ever committed.
- **Design system** — colors come from `tokens.css` (the known raw-hex
  exceptions are listed in the check itself); owing is amber, never red;
  `.app-scroll` stays unpositioned so the absolute overlays resolve to `#root`.
- **The harness itself** — the npm scripts exist, CI runs the gate before it
  builds, Playwright specs stay out of the vitest run, and a sanity check
  guarantees the file actually found the source (so nothing above can pass
  vacuously).

**A failure here is not a style nit.** Read the check's comment before
widening an allowlist — the allowlist is the review record.

---

## Tier 2 — live database evals (`npm run eval:live`)

Runs two scripts against the real Supabase project. Client-side validation is
a courtesy; these prove the rules are enforced where it counts.

### `scripts/rls-check.mjs` — access isolation

Eight adversarial checks: one trip's client cannot read another's trips,
participants or expenses; direct expense inserts are denied; the slug still
grants the join view (the capability model); a member cannot re-parent a
participant row, touch another trip's row, or reassign a creator. These are
the regression suite for every privilege-escalation hole found during the
build — **never widen a grant without adding the attack here first.**

### `scripts/rpc-contract-check.mjs` — write-RPC contracts

Verifies what the client depends on being true server-side:

- **`add_expense` validation** — shares that do not sum to the amount, zero or
  negative amounts and shares, empty splits, blank descriptions, a payer or
  share participant from another trip, and non-member callers are all rejected.
- **Storage fidelity** — an uneven split is stored exactly as computed, to the
  cent; edits replace the split instead of accumulating rows.
- **All-in reset** — logging an expense resets the **logger's** flag and leaves
  the **payer's** untouched (checked with two claimed members, one logging on
  the other's behalf); edits reset nobody.
- **Claim rules** — a second claimer loses the race with `false` rather than an
  error; unknown slugs are rejected.
- **Capability model** — an anonymous visitor gets the trip name and
  participant list from the link and nothing else: no amounts, no expense rows.
- **Closed trips** — add, edit, flag, delete, settle, comment and
  add-participant are all refused, while reads still work.
- **Release claim** — a participant can release their own, the creator can
  release anyone's, an unrelated member cannot.

Run these after **any** change to `supabase/schema.sql`, and after applying a
migration from `supabase/migrations/` in the dashboard. Extend the scripts when
you add an access path — a new RPC without a matching contract check is an
untested security boundary.

---

## Tier 3 — flow evals (`npm run eval:e2e`)

Playwright at 390×844 against a local dev server and the live project.

- `happy-path.spec.ts` — create → claim → expense → balances → all-in →
  settle → close. The spec's one required E2E.
- `expense-lifecycle.spec.ts` — subset splits, the custom-split validator
  (save blocked until the amounts add up, on both add and edit), the "edited"
  marker, flag/resolve, comments, and delete-with-confirmation.
- `closed-trip.spec.ts` — read-only enforcement on every surface, including
  the add-expense route reached directly by URL.

---

## Definition of green

Before calling any change done:

- **Always:** `npm run eval` (typecheck + units + invariants).
- **Touched `supabase/` or `src/data/`:** also `npm run eval:live`.
- **Touched a user flow or screen:** also `npm run eval:e2e`.
- **Shipping:** `npm run build` clean (CI enforces the gate, then builds).

## Costs

Tiers 2 and 3 create permanent rows — trips, participants, expenses and
anonymous auth users — in the live database. There is no cleanup path; this is
accepted at personal scale, and is why they are local-only and not in CI. Trip
names are prefixed (`E2E …`, `RPC contract …`) so they are easy to spot.

## Known gaps

Deliberately not covered, so nobody assumes otherwise:

- **44px hit areas** and visual layout — enforced by review and the design
  handoff, not by an automated check. A static check on inline styles was more
  fragile than it was worth.
- **Realtime propagation** — the multi-client "expense appears within ~1s"
  behavior needs two live browsers; not automated.
- **Offline behavior** — the banner and write-blocking are exercised by hand.
- **Settlement participants are not constrained to the trip.** The
  `settlements` insert policy checks trip membership but not that
  `from`/`to` belong to that trip, so a member could record a settlement in
  their own trip referencing an outside participant id. It cannot affect any
  other trip's balances, and any member can already edit or delete anything
  under the friends-trust model — but it is a missing constraint, and it is
  worth a `check` on the table if the ledger work in the roadmap goes ahead.

## Adding an eval

Put it in the cheapest tier that can catch the bug:

- Pure logic → a vitest file next to the code (`src/lib/*.test.ts`).
- A rule about the *shape* of the repo, schema or config → a check in
  `evals/invariants.test.ts`.
- A rule the database must enforce → `scripts/rpc-contract-check.mjs`
  (or `rls-check.mjs` if it is an access-boundary attack).
- A rule about what the user sees → an `e2e/` spec.

New tier-1 files are picked up automatically. New tier-2 scripts must be added
to the `eval:live` npm script, and `evals/invariants.test.ts` asserts they
exist and are documented here.
