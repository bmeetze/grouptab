# GroupTab — Roadmap

What to build next, in what order, and why. This file decides **priority only**.
Current behavior is in [spec.md](spec.md); the design of a feature in active work
is in [features/](features/).

**Last reordered:** 2026-11-07, by impact. Multi-currency moved to #1 after a
recent Mexico City trip confirmed the demand. Four former top items shipped on
2026-11-07 and are listed under [Shipped](#shipped).

## How items are scored

Each factor is scored 1–5: **Reach** (share of trips that hit the need),
**Impact** (user or trust benefit), **Confidence** (evidence from the usability
review and current code), **Effort** (implementation and operational cost).
Score = (R × I × C) ÷ E. Scores are planning estimates, not analytics.

Order is by Impact; ties break by Score. Dependencies, security and strategy can
override either, and the "why" column says when they do.

| # | Feature | R | I | C | E | Score | Why it sits here | Feature doc |
| --: | --- | --: | --: | --: | --: | --: | --- | --- |
| 1 | Multi-currency | 3 | 5 | 4 | 3 | 20.0 | Demand proven; Tricount and Splid support 150+ currencies. Log each expense's currency, convert once at settle-up | [01](features/01-multi-currency.md) |
| 2 | Settlement ledger, partial payments, corrections | 4 | 5 | 5 | 3 | 33.3 | Financial correctness; must come before payment handoff | — |
| 3 | Stricter permissions and audit trail | 2 | 5 | 3 | 4 | 7.5 | High impact only once the app is used beyond trusted groups | — |
| 4 | Landing page and "Your trips" home | 5 | 4 | 4 | 3 | 26.7 | Gives new users a front door and returning users a way back | — |
| 5 | Payment handoff | 3 | 4 | 4 | 2 | 24.0 | The last step, once settlements can be corrected | — |
| 6 | Claim recovery and participant management | 3 | 4 | 3 | 3 | 12.0 | Touches device identity and past money data | — |
| 7 | Link regeneration and revocation | 2 | 4 | 4 | 3 | 10.7 | Rises in priority as use extends beyond trusted groups | — |
| 8 | Anonymous-to-account upgrade | 2 | 4 | 3 | 5 | 4.8 | The lasting recovery fix, but complex | — |
| 9 | Expense search and filters | 3 | 3 | 4 | 2 | 18.0 | Worth it as trips grow | — |
| 10 | Weighted splits | 3 | 3 | 4 | 2 | 18.0 | A shortcut; custom splits already cover the need | — |
| 11 | Coordination reminders | 3 | 3 | 4 | 2 | 18.0 | Sharing has shipped, so this is unblocked | — |
| 12 | Per-person spending summary | 2 | 2 | 4 | 1 | 16.0 | Informational, not part of a core flow | — |
| 13 | Expense date editing | 2 | 2 | 5 | 2 | 10.0 | Accuracy; blocks nothing | — |

## One-line briefs

Each line is the problem and the rough shape. When an item moves into active work,
it gets a feature doc and its line here links to it.

1. **Multi-currency** — USD-only blocks international trips. Record each expense in its original currency; settle in USD at one rate set at settle-up. → [features/01-multi-currency.md](features/01-multi-currency.md)
2. **Settlement ledger** — A settlement records too little and "Mark paid" can't be safely undone. Confirm payer, recipient and an editable amount; record method, note, logger and time; correct with reversal entries, never edits.
3. **Stricter permissions and audit trail** — Anyone can edit or delete any expense with no history. Decide the policy first, enforce it in database policy, keep an append-only change log.
4. **Landing page and "Your trips"** — One home screen serves neither newcomers nor returning users. Landing page with Create/Join when no trips are claimed; otherwise "Your trips", active first.
5. **Payment handoff** — The app says who pays whom but doesn't help anyone pay. Optional per-participant payment method and handle (Venmo, Zelle), deep links where practical; GroupTab never moves money.
6. **Claim recovery and participant management** — Device-bound claims strand people after a lost device. A recovery path that doesn't depend on the original device; rename unclaimed participants; retire people only when past math stays intact.
7. **Link regeneration and revocation** — A leaked slug is valid forever. An authorized owner replaces the slug; the old one stops working; claimed members keep access.
8. **Anonymous-to-account upgrade** — Attach a real sign-in to an existing anonymous identity without losing its trips; anonymous stays the default.
9. **Expense search and filters** — Long feeds are hard to scan. Client-side text search and a flagged-only filter first; payer filter later if useful.
10. **Weighted splits** — Proportional costs are slow to enter. A third split mode with integer weights, converted to integer-cent shares by a documented leftover-cent rule.
11. **Coordination reminders** — Groups stall on unclaimed names, missing all-ins and unpaid transfers. "Share reminder" actions that produce a prefilled message; no push or accounts.
12. **Per-person spending summary** — Show amount paid and net balance side by side, clearly labeled; nothing new persisted.
13. **Expense date editing** — Expenses are dated when logged, not incurred. Optional incurred date defaulting to today; creation timestamp kept for audit.

## Shipped

Behavior for these now lives in [spec.md](spec.md).

| Feature | Shipped | Plan |
| --- | --- | --- |
| Native sharing and invite entry | 2026-11-07 | [plans/roadmap-1-4-onboarding-batch.md](plans/roadmap-1-4-onboarding-batch.md) |
| Explicit creator identity | 2026-11-07 | same |
| Description autocomplete | 2026-11-07 | same |
| Flag surfacing | 2026-11-07 | same |

## Not planned

- **Web push notifications** — subscription management costs too much to run for a no-account, personal-use product.
- **Payment processing** — payment handoff means instructions and optional deep links only.
- **Not yet roadmapped** — receipts and OCR, itemized splitting, native apps, settlement idempotency constraints, trip delete.

## Feature docs

A feature doc is created when an item moves into active work — not before. Name it
`features/NN-short-name.md`, where NN is the roadmap number when work started (the
number stays even if the roadmap is reordered later). Sections:

1. **Status** — Designing · Planned · Building · Shipped (with date and PR).
2. **Problem** — who hits it and what it costs them.
3. **Decisions** — what's settled, with the date and the reason.
4. **Open questions** — must be empty before status moves to Planned.
5. **Spec delta** — the exact text to add to or change in [spec.md](spec.md). Merged into the spec in the PR that ships the feature.
6. **Acceptance criteria** — testable statements; money rules get unit tests.
7. **Implementation plan** — a link to `plans/NN-short-name.md`, written by the agent in plan mode and reviewed before code is written: files, migration snippet, tests, eval changes. (Plans live in [plans/](plans/), as the onboarding batch's does.)

When a feature ships: merge its spec delta into `spec.md`, set the doc's status to
Shipped, and move its roadmap row to Shipped. The doc stays as the record of why.
