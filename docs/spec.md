> **Repo mirror.** The owner's working copy lives in their workspace (`Projects/Group Trip Expense Splitter/grouptab-design-spec.md`). If you change product behavior, update BOTH copies. In this repo: the design handoff is [design-handoff.md](design-handoff.md), the interactive prototype is [prototype.html](prototype.html).

# GroupTab — Group Trip Expense Splitter — Design Spec

**Date:** 2026-07-09 (original 2026-07-08; consolidated after the design/prototyping phase — this is the single source of truth)
**Status:** Design final, pending implementation plan
**Working name:** GroupTab (placeholder, easy to change)

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
- Multi-currency (USD only)
- Payment processing or payment deep links (money moves via Venmo/Zelle outside the app)
- Native mobile apps or push notifications
- Offline write queue (reads cached; writes require connectivity)
- Ongoing groups (roommates, couples) — trips only
- Fine-grained permissions (friends-trust model; hardening is a public-launch task)

## Product Design

### Create a trip
Creator opens the app, names the trip ("Tahoe 2026"), types in participant names, and claims their own name. They get a share link to post in the group chat. No account required.

### Join
A friend taps the link, sees the trip and its participant list, taps their unclaimed name, and is in. Their device remembers the claim from then on. Add-to-home-screen makes it feel like an app.

### Trip screen
- Your net balance at top ("you're owed $84") and trip total spend
- Expense feed below, newest first, updating live as others log expenses
- Flagged expenses carry a visible badge

Readiness ("all in") status intentionally does **not** appear here — it lives on the Settle tab only, where the decision it informs actually happens (decided 2026-07-09, keeps the feed clean).

### Add expense (the 3-tap path)
One screen optimized for speed:
- Amount keypad front and center (in-app keypad avoids the mobile keyboard sliding over the layout and iOS zoom-on-focus; physical keyboard also works on desktop — digits, backspace, Enter to save)
- **Description is required** — save is disabled until both amount and description are filled; the group needs to know what each expense was
- Payer defaults to *you*; tapping **"Paid by"** opens a participant picker so an expense someone else paid can be logged on their behalf (decided 2026-07-09; not shown in the prototype — see Design Reference)
- Split defaults to *everyone, equally*
- Charging a subset: tap participant avatars to toggle them out
- A switch flips to custom mode: per-person dollar inputs with a live "adds up ✓ / $x of $y assigned" validator; save is blocked until the amounts sum exactly to the total

### Expense detail
- Split breakdown (who owes what on this expense)
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
- Minimized transfer list from debt simplification ("Jake pays Brandon $142"), each with a "mark paid" button
- "Mark paid" records a settlement and updates balances; paid transfers move to a payment-history list
- When all balances are zero, balances collapse to an "All squared up" summary and the trip can be closed; closed trips are read-only

### Navigation
Three-tab persistent bar on trip screens: **Home | Expenses | Settle up**. Home lists all trips this device has claimed a name in, with the active trip as a hero card carrying the user's net balance and a quick-add button. A People screen (from the trip header) handles claim status and releasing claims.

### Export
Any participant can download the trip's expenses and settlements as a CSV file. This doubles as the backup story, since the Supabase free tier has no automatic backups.

## Architecture

**Stack:** React PWA (Vite) hosted on GitHub Pages, deployed by a GitHub Action on every push (same workflow as the World Cup tracker). Supabase for Postgres, realtime subscriptions, anonymous auth, and row-level security. Free tiers on both cover personal use indefinitely. The repo must be public for free GitHub Pages — acceptable because the frontend contains no secrets (the Supabase anon key that ships to browsers is public by design) and all trip data lives in Supabase, not the repo.

**Keeping Supabase alive:** Supabase pauses free projects after 7 days of no database activity. A scheduled GitHub Action pings the database twice a week to prevent this, so the app never goes dark between trips.

**SPA routing on GitHub Pages:** trip links like `/t/<slug>` are handled with the standard 404.html fallback trick so shared links open directly, keeping URLs clean for the group chat.

**Identity without signup:** claiming a name creates a Supabase *anonymous session* on the device, tied to the participant row. This provides real per-person identity for security rules without a visible login. Anonymous sessions can later upgrade to real accounts (email/Google) without losing history — this is the "designed for public" hook.

**Access model:** the trip link is the capability — an unguessable URL slug grants access, like a private Google Doc link. Row-level security scopes all reads/writes to the trip. The Home screen's trip list is the one cross-trip read: a device sees the trips where its anonymous session has claimed a participant row. No link regeneration in v1 (public-launch item).

**Live updates:** each open client subscribes to its trip's changes via Supabase Realtime; new expenses appear on everyone's screen within ~1 second. Auto-reconnect and refetch-on-focus cover dropped connections.

## Data Model

Six tables:

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `trips` | One per trip | name, share_slug (unguessable), status (active/closed), creator_participant_id |
| `participants` | People in a trip | trip_id, name, claimed_by (anonymous auth uid, nullable), all_expenses_in (boolean, reset when that participant logs a new expense) |
| `expenses` | Logged spending | trip_id, payer_participant_id, description, amount_cents, flagged, flagged_by_participant_id (nullable), created/updated timestamps |
| `expense_shares` | One row per person per expense | expense_id, participant_id, amount_cents |
| `comments` | Context on expenses | expense_id, participant_id, body, created_at |
| `settlements` | Recorded payments | trip_id, from_participant_id, to_participant_id, amount_cents |

## Money Rules

- All amounts stored as **integer cents**. No floats anywhere in money math.
- `expense_shares` stores **computed amounts even for equal splits** — a $100 three-way split is permanently recorded as 3334/3333/3333 cents. No rounding ambiguity later.
- Leftover cents on uneven division go to the **payer** if the payer is in the split; otherwise to the first split participant (deterministic order).
- Custom splits must sum exactly to the expense total (validated on save).
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

The UI is fully specified in the design handoff package (`design_handoff_grouptab/`): Trailhead visual system (Instrument Sans, pine green `#1f6f54` on off-white `#f4f6f4`, amber — never red — for owing), an interactive hi-fi prototype covering every screen and state, and a README with exact tokens, layouts, and behaviors. One deliberate addition in this spec is not shown in the prototype: the **payer picker** on the Add expense screen ("Paid by" opens a participant list). Where this spec and the prototype disagree, this spec wins.

## Future (Public Launch) Considerations — explicitly out of v1 scope

- Anonymous-to-real account upgrade flow
- Link regeneration / revocation
- Stricter edit/delete permissions and audit trail
- Multi-currency, receipts, itemization
- Native app / push notifications

See `docs/feature-roadmap.md` for prioritized, scoped briefs on these and other
near-term opportunities (a coding-agent backlog, not a build queue) — a brief
existing there doesn't mean it should be built without being explicitly asked for.
