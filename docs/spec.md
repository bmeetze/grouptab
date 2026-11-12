> **What this file is.** The spec of the product as it works **today** — shipped behavior only. Proposed changes live in [features/](features/) until they ship; priorities live in [roadmap.md](roadmap.md). When a feature ships, merge its spec delta here in the same PR. Design handoff: [design-handoff.md](design-handoff.md); interactive prototype: [prototype.html](prototype.html).

# GroupTab — Group Trip Expense Splitter — Spec

**Status:** v1 shipped July 2026 (live at https://bmeetze.github.io/grouptab/); onboarding batch and multi-currency shipped November 2026
**Originally consolidated:** 2026-07-09, after the design/prototyping phase

## Overview

A mobile-first web app for splitting expenses on group trips. Built because Splitwise has become unusable: core features are paywalled, expense entry is slow, and the account/install requirement means half the group never participates.

**Guiding constraint (from Brandon):** the simplest and cheapest version that supports the use case. Personal use first, but architecture choices must not box out a future public launch.

## Goals

1. **Zero group friction** — a friend goes from tapping a link to logging an expense in under 30 seconds, with no signup, password, or app install.
2. **Fast expense entry** — the common case (paid for everyone, split equally) is amount → description → save.
3. **Free** — no paywall for any feature; runs on free hosting tiers for personal use.
4. **Trustworthy settle-up** — everyone sees the same minimized transfer list and can verify it against the expense feed.

## Non-Goals (v1)

- Receipt photos / OCR
- Itemized bill splitting (assigning line items to people)
- Payment processing or payment deep links (money moves via Venmo/Zelle outside the app)
- Native mobile apps or push notifications
- Offline write queue (reads cached; writes require connectivity)
- Ongoing groups (roommates, couples) — trips only
- Fine-grained permissions (friends-trust model; hardening is a public-launch task)

## Product Design

### Create a trip
Creator opens the app, names the trip ("Tahoe 2026"), and types in participant names. They then **tap which name is theirs** — the selection is required and has no default, so listing someone else first can't silently claim the wrong participant. That selection (not list position) becomes the claimed participant and the trip's `creator_participant_id`. They get a share link to post in the group chat. No account required.

### Join
A friend taps the link, sees the trip and its participant list, taps their unclaimed name, and is in. Their device remembers the claim from then on. Add-to-home-screen makes it feel like an app.

Someone who has the link but not an open browser tab can also reach a trip through **Join a trip** on Home: paste a full invite URL or a bare slug. Input is only shape-checked locally (16 lowercase hex chars, any origin accepted) and never probed against the database before navigating — the box must not become an oracle for guessing slugs. Unrecognisable input gives an inline error; a well-formed slug that doesn't resolve gets the normal "Trip not found."

### Sharing
The trip header's share control opens the **system share sheet** where the Web Share API is available and falls back to copy-to-clipboard elsewhere. Dismissing the sheet is silent, not an error. Trip creation stays on clipboard-only: `navigator.share` requires user activation, which the create round-trip can consume.

### Trip screen
- Your net balance at top ("you're owed $84") and trip total spend, both in USD
- An expense in another currency shows its original amount with a USD estimate beneath ("MX$850.00" / "≈ $45.45"). The ≈ marks a display estimate: it moves with the trip rate and can differ from the balance math by a cent
- Expense feed below, newest first, updating live as others log expenses
- Flagged expenses carry a visible badge
- When any expense is flagged, a banner above the feed shows the count and links straight to the flagged expense, so an unresolved dispute isn't buried in a long feed. Derived from the loaded expenses — a flag is not a second dispute state.

Readiness ("all in") status intentionally does **not** appear here — it lives on the Settle tab only, where the decision it informs actually happens (decided 2026-07-09, keeps the feed clean).

### Add expense (the 3-tap path)
One screen optimized for speed:
- **One input method: the system keyboard.** The form reads top to bottom — Amount, What for, who paid and the split, Save — and every typed value is an ordinary field. The amount field comes first and is focused on arrival, so the decimal keyboard is already up; the description uses the text keyboard. (Decided 2026-11-12, replacing the in-app keypad: two input methods on one screen was confusing, the keypad took most of the screen, and nothing said the amount came first. The keypad's original reasons are handled differently — fields are ≥16px so iOS doesn't zoom on focus, and Save sits in the flow under the split card, not pinned to the bottom, so the keyboard doesn't cover it.)
- The amount field accepts digits and one decimal separator (a comma is read as a point), up to 7 digits, with the currency's decimal places. Enter in the amount field moves to the description; Enter anywhere saves once the form is valid
- While Save is disabled, a line under it says what's missing ("Enter an amount to start", "Add what it was for")
- **Currency** chip inside the amount field opens a picker of 30 currencies (USD plus the European Central Bank list). A new expense defaults to the currency of the trip's most recent expense; a brand-new trip starts in USD. The amount field follows the currency's decimal places (JPY, KRW and ISK have none)
- The **first expense in a currency** also asks for that currency's trip rate ("1 MXN = $___"), pre-filled with today's ECB rate from Frankfurter and editable; if the fetch fails, the logger types it. Later expenses in that currency don't ask again
- **Description is required** — save is disabled until both amount and description are filled; the group needs to know what each expense was
- Typing a description offers up to four matching descriptions already used on this trip as one-tap chips (recent first). Selecting one sets the description only — amount, payer and split are untouched. Trip-local, no new stored data.
- Payer defaults to *you*; tapping **"Paid by"** opens a participant picker so an expense someone else paid can be logged on their behalf (decided 2026-07-09; not shown in the prototype — see Design Reference)
- Split defaults to *everyone, equally*
- Charging a subset: tap participant avatars to toggle them out
- A switch flips to custom mode: per-person amount inputs (in the expense's currency) with a live "adds up ✓ / $x of $y assigned" validator; save is blocked until the amounts sum exactly to the total

### Expense detail
- Split breakdown (who owes what on this expense), in the expense's own currency, with the ≈USD estimate under a foreign total
- Comment thread for context ("this was the boat deposit")
- Flag button — anyone can flag an expense for review, and the flag shows who raised it ("⚑ Flagged by Maya"); anyone can resolve the flag
- Edit / delete (confirmation prompt on delete; edited expenses show an "edited" marker)

### "All my expenses are in" (readiness)
Settling too early is a real failure mode: totals change after someone has already paid. Each participant has an **"All my expenses are in"** toggle at the top of the Settle tab, with an avatar status row ("2 of 3 in · waiting on Jake"). It is a soft signal, not a lock — a participant can undo it, and nothing prevents settling before everyone is in:
- Until everyone has flipped it, transfers carry a **DRAFT — may change** badge (paying early is allowed, just flagged)
- When the last person flips it, the toggle collapses to an "Everyone's in ✓ — these numbers are final" ribbon and transfers become **FINAL**

**Auto-reset:** logging a new expense resets the **logger's** flag, so the declaration is never older than that person's latest expense — they re-confirm with one tap. The reset keys on who logged the expense, not who paid it (logging a dinner on someone else's behalf resets your status, not theirs). Edits do not reset anyone: they're corrections, and disputes are handled by flags and comments.

Data model: `all_expenses_in` boolean on `participants`.

### Settle up
The Settle tab:
- Each person's net position shown as a small horizontal bar chart diverging from a center zero line (summary only — the actionable unit is the transfer list below)
- Minimized transfer list from debt simplification ("Jake pays Brandon $142"), each with a "mark paid" button. Balances and transfers are always in USD
- **Exchange rates** card (when the trip has foreign expenses): one shared rate per currency for the whole trip. Any member can edit a rate while the trip is open; an actual change clears **everyone's** all-in, so transfers return to DRAFT and the group re-confirms (re-saving the same rate changes nothing)
- Settlements are fixed USD amounts whenever recorded. If a rate changes after someone paid, the remaining transfers recompute and any true-up shows as a new transfer
- "Mark paid" records a settlement and updates balances; paid transfers move to a payment-history list
- When all balances are zero, balances collapse to an "All squared up" summary and the trip can be closed; closed trips are read-only

### Navigation
Three-tab persistent bar on trip screens: **Home | Expenses | Settle up**. Home lists all trips this device has claimed a name in, with the active trip as a hero card carrying the user's net balance and a quick-add button. A People screen (from the trip header) handles claim status and releasing claims.

### Export
Any participant can download the trip's expenses and settlements as a CSV file: amounts in each row's own currency with currency and USD-estimate columns, followed by the trip's exchange rates. This doubles as the backup story, since the Supabase free tier has no automatic backups.

## Architecture

**Stack:** React PWA (Vite) hosted on GitHub Pages, deployed by a GitHub Action on every push (same workflow as the World Cup tracker). Supabase for Postgres, realtime subscriptions, anonymous auth, and row-level security. Free tiers on both cover personal use indefinitely. The repo must be public for free GitHub Pages — acceptable because the frontend contains no secrets (the Supabase anon key that ships to browsers is public by design) and all trip data lives in Supabase, not the repo.

**Keeping Supabase alive:** Supabase pauses free projects after 7 days of no database activity. A scheduled GitHub Action pings the database twice a week to prevent this, so the app never goes dark between trips.

**SPA routing on GitHub Pages:** trip links like `/t/<slug>` are handled with the standard 404.html fallback trick so shared links open directly, keeping URLs clean for the group chat.

**Identity without signup:** claiming a name creates a Supabase *anonymous session* on the device, tied to the participant row. This provides real per-person identity for security rules without a visible login. Anonymous sessions can later upgrade to real accounts (email/Google) without losing history — this is the "designed for public" hook.

**Access model:** the trip link is the capability — an unguessable URL slug grants access, like a private Google Doc link. Row-level security scopes all reads/writes to the trip. The Home screen's trip list is the one cross-trip read: a device sees the trips where its anonymous session has claimed a participant row. No link regeneration in v1 (public-launch item).

**Live updates:** each open client subscribes to its trip's changes via Supabase Realtime; new expenses appear on everyone's screen within ~1 second. Auto-reconnect and refetch-on-focus cover dropped connections.

## Data Model

Seven tables:

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `trips` | One per trip | name, share_slug (unguessable), status (active/closed), creator_participant_id |
| `participants` | People in a trip | trip_id, name, claimed_by (anonymous auth uid, nullable), all_expenses_in (boolean, reset when that participant logs a new expense) |
| `expenses` | Logged spending | trip_id, payer_participant_id, description, currency (ISO 4217, default USD), amount_cents (minor units of `currency`), flagged, flagged_by_participant_id (nullable), created/updated timestamps |
| `expense_shares` | One row per person per expense | expense_id, participant_id, amount_cents (minor units of the expense's currency) |
| `comments` | Context on expenses | expense_id, participant_id, body, created_at |
| `settlements` | Recorded payments | trip_id, from_participant_id, to_participant_id, amount_cents (always USD) |
| `trip_rates` | One shared rate per foreign currency per trip | trip_id, currency, usd_nanos_per_unit (integer billionths of a USD per one unit), set_by_participant_id, set_at. Written only by `add_expense` (first use) and `set_rate` |

## Money Rules

- All amounts stored as **integer minor units** of their currency (cents for USD, yen for JPY; decimal places come from a fixed ISO 4217 table, never the browser). No floats anywhere in money math. Settlements, balances and transfers are USD cents.
- `expense_shares` stores **computed amounts even for equal splits** — a $100 three-way split is permanently recorded as 3334/3333/3333 cents. No rounding ambiguity later.
- Leftover cents on uneven division go to the **payer** if the payer is in the split; otherwise to the first split participant (deterministic order).
- Custom splits must sum exactly to the expense total (validated on save).
- **Conversion happens once, at the balance step, never at entry.** Balances are computed per currency in minor units; each person's balance in each foreign currency is converted to USD with integer math at the trip rate, floored to the cent, and the cents still needed for the group to sum to exactly $0.00 go to the largest remainders (ties: participant order). USD-only trips skip conversion entirely.
- Balance per person = total paid − total shares **+ settlements sent − settlements received** (sending a payment moves your balance toward zero — this is how "mark paid" clears debts; matches the prototype's `balances()`).
- The minimized transfer list is computed on the fly with a standard greedy debt-simplification algorithm — never stored, so it is always consistent with the underlying data.

## Edge Cases & Error Handling

- **Claim conflict:** a DB uniqueness constraint lets the first claimer win; the second gets a "name taken, pick again" message.
- **Wrong name / lost device:** any participant can release their own claim; the trip creator can release anyone's. The person re-claims on the new device.
- **Late joiner:** adding a participant mid-trip only affects future default splits; existing expenses are untouched unless edited.
- **Edit/delete rights:** anyone in the trip can edit or delete any expense (friends-trust model), with a delete confirmation. Disputes are handled socially via flags and comments.
- **Validation:** amount > 0; at least one participant in every split; payer may be excluded from the split (paying on others' behalf).
- **Offline:** clear offline banner; writes disabled until reconnected; failed saves show a retry toast.
- **Closed trips:** fully read-only.

## Testing

Focused on the correctness core, per the simplest-and-cheapest constraint:

1. **Unit tests (thorough):** split math (equal, unequal, subsets, leftover-cent assignment), balance computation, debt simplification — including the invariant that every generated transfer list fully settles all balances with at most n−1 transfers.
2. **Access isolation:** verify one trip's client cannot read another trip's data (RLS check).
3. **E2E happy path (one test):** create trip → claim name → add expense → verify balances → all-in → settle → close.

## Design Reference

The UI is fully specified in the design handoff ([design-handoff.md](design-handoff.md), with the interactive prototype at [prototype.html](prototype.html)): Trailhead visual system (Instrument Sans, pine green `#1f6f54` on off-white `#f4f6f4`, amber — never red — for owing), an interactive hi-fi prototype covering every screen and state, and a README with exact tokens, layouts, and behaviors. One deliberate addition in this spec is not shown in the prototype: the **payer picker** on the Add expense screen ("Paid by" opens a participant list). Where this spec and the prototype disagree, this spec wins.

## Future work

Not part of current behavior. Everything proposed — multi-currency, account upgrade, link regeneration, stricter permissions and the rest — is prioritized in [roadmap.md](roadmap.md) and designed in [features/](features/).
