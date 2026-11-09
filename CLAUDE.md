# CLAUDE.md — agent guide to GroupTab

GroupTab is a shipped, live, personal-use group-trip expense splitter: a mobile-first
React PWA on GitHub Pages with Supabase (Postgres, Realtime, anonymous auth, RLS)
behind it. Live at **https://bmeetze.github.io/grouptab/**. v1 is complete and
reviewed; treat the codebase as production, not a prototype.

## Read these before changing product behavior

Docs follow one rule: **each fact lives in exactly one file.**

- [docs/spec.md](docs/spec.md) — what the product does **today**. Shipped behavior
  only — **source of truth**. Where it and the design prototype disagree, the spec wins.
- [docs/roadmap.md](docs/roadmap.md) — what's next and in what order. Priority only;
  no design detail.
- [docs/features/](docs/features/) — one doc per feature in active work: decisions,
  open questions, spec delta, acceptance criteria. A feature doc describes
  **proposed** behavior — never treat it as current. Don't plan or build a feature
  whose doc still has open questions; raise them with the owner.
- [docs/plans/](docs/plans/) — implementation plans, written in plan mode and
  reviewed before code. Each is linked from its feature doc.
- [docs/design-handoff.md](docs/design-handoff.md) — the Trailhead visual system:
  exact tokens, per-screen layouts and copy. [docs/prototype.html](docs/prototype.html)
  is the interactive pixel reference (open in a browser).
- [docs/evals.md](docs/evals.md) — the standing correctness suite: what each tier
  asserts, when to run it, and where a new eval belongs.

Shipping a feature: merge its spec delta into `docs/spec.md` in the same PR, set the
feature doc's status to Shipped, and move its roadmap row to Shipped. The repo is
canonical — there is no workspace mirror to sync.

## Commands

```
npm install && npm run dev      # http://localhost:5173/grouptab/  (note the base path)
npm run eval                    # THE GATE: tsc -b + the whole vitest suite (offline, ~2s)
npm run eval:live               # RLS isolation + write-RPC contracts vs the LIVE database
npm run eval:e2e                # Playwright flow evals (local only — see caveats below)
npm run build                   # typecheck + production build (also makes dist/404.html)
npm run lint                    # oxlint (template default; not in CI, run when it helps)
git push                        # deploys: GitHub Action runs `npm run eval` + build → Pages
```

The eval suite is described in [docs/evals.md](docs/evals.md) — read it before
adding tests, and before "fixing" an invariant failure by widening an allowlist.

Node 20+ (CI uses 20). Note: the E2E and the live evals create permanent rows
(trips, anonymous auth users) in the live database — accepted at personal scale,
there is no cleanup path. That is why only tier 1 runs in CI.

Definition of green before you call any change done: `npm run eval` clean and
`npm run build` clean; add `npm run eval:live` when you touched anything
database-adjacent (`supabase/`, `src/data/`), and `npm run eval:e2e` when you
touched a user flow or screen.

## Architecture in one minute

- `src/lib/money.ts` — the correctness core. Pure functions: `computeEqualSplit`,
  `computeBalances`, `simplifyDebts`. **Every displayed number derives from these**;
  balances and transfers are computed on the fly, never stored. `src/lib/fx.ts`
  runs `computeBalances` per currency and converts to USD (`tripUsdBalances`).
- `src/data/` — Supabase client, anonymous session, API wrappers (`api.ts`), and
  `useTripData` (fetch + realtime-refetch + localStorage offline cache). Realtime
  model: subscribe to the trip's six tables, refetch the whole trip on any event.
  `rates.ts` pre-fills exchange rates from Frankfurter (api.frankfurter.dev, ECB);
  failure must only ever mean "type the rate".
- `src/screens/` — one file per screen. `TripGate` resolves `/t/:slug/*`: no claim →
  Join; else nested routes (feed / add / e/:id / people / settle). Screens receive
  `ScreenProps { slug, data, refetch, stale }` (`refetch` returns a Promise —
  await it before releasing re-entrancy locks on non-idempotent writes).
- `src/ui/tokens.css` + `src/ui/components.tsx` — the Trailhead design system
  (tokens, Avatar, TabBar, Toast, Ribbon) and the desktop app frame.
- `supabase/schema.sql` — the entire backend: tables, RLS policies, column-scoped
  grants, security-definer RPCs, realtime publication. Canonical and complete.

## Database changes — special workflow

Dev machines have **no SQL access** to the Supabase project (deliberate). To change
the schema: (1) edit `supabase/schema.sql` so it stays the canonical full schema,
(2) add an incremental snippet in `supabase/migrations/YYYY-MM-DD-name.sql` for the
owner to paste into the Supabase dashboard SQL editor, (3) after the owner applies
it, verify with `node scripts/rls-check.mjs` and extend that script if you added an
access path. The owner must also be told when a change needs a dashboard toggle
(e.g. anonymous sign-ins live under Authentication settings).

## Invariants — do not break these

- **Integer minor units everywhere.** No floats in any money path. Expense amounts
  are minor units of `expenses.currency` (exponents from `src/lib/currency.ts`, never
  `Intl`); settlements, balances and transfers are USD cents. Conversion happens
  **only** in `src/lib/fx.ts` (BigInt; per-person-per-currency, largest-remainder
  rounding) — screens call `tripUsdBalances`. Equal-split leftover cents go to the
  payer if in the split, else the first split participant. Balance = paid − shares
  **+ settlements sent − received** (sending moves you toward zero).
- **Rates are shared trip state.** One `trip_rates` row per foreign currency,
  written only by `add_expense` (first use, never overwriting) and `set_rate` (which
  clears everyone's all-in). No client write path to `trip_rates`.
- **Writes to expenses/shares go through RPCs only** (`add_expense`,
  `update_expense`) — they validate shares-sum-equals-amount server-side. Direct
  inserts are RLS-denied by design. Direct table updates are column-scoped by
  grants (participants: `all_expenses_in` only; trips: `status` only; expenses:
  flag columns only) — that scoping closed real privilege-escalation holes. Never
  widen a grant without extending `scripts/rls-check.mjs` to attack the new surface
  first (its 8 checks are the regression suite for every exploit found so far).
- **All-in auto-reset keys on who LOGGED the expense** (the RPC caller), never the
  payer; edits reset no one. Enforced in `add_expense`; don't re-implement client-side.
- **The trip link is the capability**: unguessable slug; `get_trip_by_slug` is the
  only anon-callable read. The publishable key in `src/lib/config.ts` is public by
  design — all security lives in RLS.

## Conventions (enforced by review throughout the build)

- Colors/type only via `tokens.css` custom properties. Exception: literal `#fff`
  for text on accent backgrounds. Owing/negative is amber (`--negative`) — never red.
- Every interactive element ≥44px hit area, both axes.
- Non-idempotent writes take a **synchronous ref lock** (`if (ref.current) return;
  ref.current = true`) released in `finally`. For inserts where the UI stays on the
  same list, hold the lock through `await refetch()` so stale UI can't double-fire
  (see `handleMarkPaid` in Settle); navigating away on success (AddExpense) closes
  the window equally well.
- RPC failures: try/catch → `useToast`; successful mutations → `await refetch()`.
- Closed trips are read-only: hide write affordances AND guard the handlers
  (see the two-layer pattern in AddExpense).
- `.app-scroll` (tokens.css) must stay unpositioned — the absolute overlays
  (TabBar, FAB, toast) resolve their containing block through it to `#root`.
  The app renders as a fixed-size frame on desktop (≥768px); overlays anchor to
  the frame, never the viewport.

## Gotchas that will bite you

- **Git identity:** pushes authenticate through a repo-local credential helper using
  the `bmeetze` account from the gh keyring. Don't change the remote or the helper;
  `gh api` calls against this repo need `GH_TOKEN=$(gh auth token --user bmeetze)`.
- **The E2E writes real rows to the live database** (accepted at personal scale;
  unguessable slugs). It runs at 390×844 and is not in CI — keep it local.
- `comments` carries a denormalized `trip_id` (realtime filtering + RLS without
  joins). `expenses` uses `replica identity full` so realtime DELETE events carry
  enough data (it's the only table with a client-facing delete path) — add it to
  any new table whose deletes clients must observe.
- A twice-weekly GitHub Action (`keepalive.yml`) pings the database so the Supabase
  free tier never pauses, then re-enables itself via the API so GitHub's 60-day
  no-commit rule can't switch the schedule off (it did once, Sep 2026, and the
  database paused). The Supabase URL + publishable key are hardcoded in THREE
  places — `src/lib/config.ts`, `scripts/rls-check.mjs`, `.github/workflows/keepalive.yml`
  — update all three if the project ever moves.
- iOS: Safari and installed PWAs don't share storage — users should install first,
  then claim (claims are device-bound anonymous sessions; recovery is the release-
  claim flow on the People screen).
- Vitest excludes `e2e/**` (`vite.config.ts` imports `defineConfig` from
  `vitest/config` for this) — don't "simplify" that import back to `vite`.

## Not yet in the product — don't build without the owner asking

Everything open on [docs/roadmap.md](docs/roadmap.md) is unbuilt. Build one only when
the owner pulls it into active work and its feature doc has no open questions. Also
out of scope until roadmapped: receipts, itemization, native apps/push, settlement
idempotency constraints, trip delete.
