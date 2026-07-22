# GroupTab — Feature Roadmap Briefs

These briefs describe the next product opportunities identified in a usability
review. They are intentionally concise: use the product spec as the source of
truth for existing behavior, and turn an accepted brief into a detailed
implementation plan before building it.

## Prioritization and scoring

Scores are a planning heuristic, not observed product analytics. Each factor is
scored from 1 (low) to 5 (high): **Reach** is the proportion of active trips
likely to encounter the need, **Impact** is the user or trust benefit,
**Confidence** reflects evidence from the usability review and current code,
and **Effort** is relative implementation and operational complexity. The
score is `(Reach × Impact × Confidence) ÷ Effort`. Dependencies, security, and
product strategy can move an item from its raw score position; those decisions
are stated in the rationale.

| Order | Feature                                                           |   R |   I |   C |   E | Score | Rationale                                                                                                                                       |
| ----: | ----------------------------------------------------------------- | --: | --: | --: | --: | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Native sharing and invite entry                                   |   5 |   5 |   5 |   2 |  62.5 | Highest-leverage growth and recovery path; it makes every new or returning participant easier to serve.                                         |
|     2 | Explicit creator identity                                         |   4 |   5 |   5 |   2 |  50.0 | A small change prevents a high-cost identity mistake at the moment a trip is created.                                                           |
|     3 | Description autocomplete                                          |   4 |   3 |   5 |   1 |  60.0 | Raw score is high because it is cheap, local, and repeatedly reduces entry friction; ship as a small enhancement alongside the onboarding work. |
|     4 | Flag surfacing                                                    |   3 |   4 |   5 |   1 |  60.0 | Low-effort trust improvement: unresolved disputes should not be buried in a long feed.                                                          |
|     5 | Settlement ledger, partial payments, confirmation, and correction |   4 |   5 |   5 |   3 |  33.3 | Financial correctness and auditability outweigh its moderate effort. It must precede payment handoff.                                           |
|     6 | Landing page and “Your trips” home                                |   5 |   4 |   4 |   3 |  26.7 | A clear front door and return path make the invite work easier to understand and retain.                                                        |
|     7 | Payment handoff                                                   |   3 |   4 |   4 |   2 |  24.0 | Valuable final-mile improvement once settlement records are safe and correctable.                                                               |
|     8 | Expense search and filters                                        |   3 |   3 |   4 |   2 |  18.0 | Becomes valuable as trips grow; start with text search and flagged-only filtering.                                                              |
|     9 | Weighted splits                                                   |   3 |   3 |   4 |   2 |  18.0 | A useful shortcut over custom splits, but not a blocker because exact custom amounts already work.                                              |
|    10 | Claim recovery and participant management                         |   3 |   4 |   3 |   3 |  12.0 | Important resilience work; design it carefully because it touches device identity and historical money data.                                    |
|    11 | Coordination reminders                                            |   3 |   3 |   4 |   2 |  18.0 | Useful completion aid, but it depends on sharing and does not repair the core financial loop.                                                   |
|    12 | Link regeneration and revocation                                  |   2 |   4 |   4 |   3 |  10.7 | Security/resilience work that rises in priority as use extends beyond trusted small groups.                                                     |
|    13 | Per-person spending summary                                       |   2 |   2 |   4 |   1 |  16.0 | Easy reporting value, but informational rather than flow-critical.                                                                              |
|    14 | Expense date editing                                              |   2 |   2 |   5 |   2 |  10.0 | Improves historical accuracy without blocking core trip work.                                                                                   |
|    15 | Stricter permissions and audit trail                              |   2 |   5 |   3 |   4 |   7.5 | Necessary before broader/public use; defer until the trusted-friends model no longer fits.                                                      |
|    16 | Anonymous-to-account upgrade                                      |   2 |   4 |   3 |   5 |   4.8 | The durable recovery solution, but it adds significant identity and migration complexity.                                                       |
|    17 | Multi-currency                                                    |   1 |   5 |   4 |   5 |   4.0 | High impact only for international trips and changes core money assumptions; defer until demand is proven.                                      |

**Not planned now.** Web push notifications remain out of scope: they require
subscription management and operational complexity disproportionate to the
personal-use, no-account product. Payment processing is also out of scope;
payment handoff means instructions and optional deep links only.

## 1. Explicit creator identity

**Problem.** Creating a trip silently claims the first name entered as the
creator's identity. A creator who lists someone else first can accidentally
claim the wrong participant, creating confusing balances and a hard-to-recover
identity mismatch.

**Solution shape.** Keep participant entry simple, but add an explicit
“Which one is you?” selection before creation. The chosen participant is
claimed by the creator's anonymous session and becomes the trip creator.

**Success criteria.** A creator can see and confirm the identity they will
claim before submitting. The selected person—not list position—becomes the
claimed participant and `creator_participant_id`.

## 2. Native sharing and invite entry

**Problem.** On mobile, the current Share control only copies a link. It adds
friction at the exact moment a trip needs to move into a group chat. People who
lose the link also have no clear way to rejoin a trip from the app.

**Solution shape.** Use the Web Share API when available, with copy-to-clipboard
as the fallback. Add a visible “Join a trip” entry point where a user can paste
a GroupTab invite URL or enter the existing full share slug.

**Security constraint.** The slug is a capability: do not introduce a short or
guessable code that can reveal trip data. If human-friendly codes are added in
the future, they must retain comparable entropy or require an additional secret.

**Success criteria.** Mobile sharing opens the system share sheet when supported.
Pasting a valid link or slug reaches the trip's claim screen; invalid input gives
a clear error and reveals no trip information.

## 3. Landing page and “Your trips” home

**Problem.** A new visitor needs a quick explanation of what GroupTab does and
why they should use it. A returning user instead needs fast access to trips
already claimed on this device. One undifferentiated home screen serves neither
case especially well.

**Solution shape.** Present a lightweight landing page when the device has no
claimed trips: concise value proposition, “Create a trip,” and “Join a trip.”
When trips exist, present “Your trips,” ordered with active trips first and
recently updated/closed trips afterward, while retaining both actions.

**Success criteria.** A first-time visitor can understand the product and start
or join a trip without needing a shared link already open. A returning user can
open any claimed trip from Home in one tap.

## 4. Settlement ledger, confirmation, and correction

**Problem.** Settlements currently affect balances immediately, but the payment
record is too sparse for a real-world group payment: there is no confirmation,
payment method/reference, recorder identity, or safe correction path. An
accidental “Mark paid” can incorrectly make a trip appear settled.

**Solution shape.** Treat each settlement as a visible ledger transaction.
Before recording it, confirm payer, recipient, and an editable amount that
defaults to the suggested full transfer. Support optional method and note
fields; record who logged it and when. Show transactions in a chronological
history and make corrections explicit (for example, a reversal or void entry),
rather than silently changing history.

**Success criteria.** Every recorded payment is auditable and visibly explains
its impact on balances. A partial payment reduces the remaining transfer by
exactly its recorded integer-cent amount. Users can correct an accidental
payment without rewriting the record. Closing a trip remains based on balances
derived from the ledger.

## 5. Payment handoff

**Problem.** The settle screen says who should pay whom, but it does not help
the payer complete the payment outside GroupTab. This leaves the final,
time-sensitive step to manual coordination.

**Solution shape.** Let participants optionally publish a preferred payment
method and handle (for example, Venmo or Zelle). Display the recipient's
instructions on each transfer and, where practical, provide a deep link. Do
not process money in GroupTab.

**Success criteria.** A payer can see the recipient's preferred way to pay from
the transfer card. No payment account details are required to create, join, or
use a trip.

## 6. Claim recovery and participant management

**Problem.** Anonymous, device-bound claims are intentionally low-friction but
can strand people after a lost device, browser-storage reset, or Safari/PWA
switch. Participant names also cannot be corrected, and an attendee who drops
out cannot be cleanly retired.

**Solution shape.** Provide a recovery path that lets an eligible participant
reclaim their name without relying solely on the original device. Add safe
participant management: rename unclaimed participants and remove or retire a
participant only when doing so cannot corrupt historical expenses and shares.

**Success criteria.** A user with a legitimate recovery path can reclaim their
identity. Participant changes preserve past expense math and clearly state why
an unsafe removal is unavailable.

## 7. Coordination reminders

**Problem.** Groups often stall because someone has not claimed a name, marked
their expenses complete, or paid a transfer. The app exposes these states but
does not help a coordinator act on them.

**Solution shape.** Add contextual “Share reminder” actions for unclaimed
participants, outstanding all-in confirmations, and unpaid transfers. Start
with copyable, prefilled message text; native share can distribute it. Do not
require push notifications or accounts in this phase.

**Success criteria.** From the relevant state, a coordinator can produce a
clear reminder in one or two taps. The message contains only the trip link and
the minimum context needed to act.

## 8. Expense date editing

**Problem.** Expenses are dated when logged, not when incurred. On a trip,
people commonly enter a receipt later, making the feed and CSV chronology less
useful.

**Solution shape.** Add an optional expense date that defaults to today and can
be changed when adding or editing an expense. Preserve the separate record
creation timestamp for audit/history purposes.

**Success criteria.** Users can backdate an expense without changing its amount,
shares, or creation history. Feed and CSV date behavior is consistent and
documented.

## 9. Description suggestions

**Problem.** Repeat trip costs such as groceries, parking, and dinner must be
typed from scratch every time, adding friction to the app's fastest path.

**Solution shape.** As the user enters a description, offer recent unique
descriptions from the current trip as selectable suggestions. Keep the data
local to the trip and retain free-form entry.

**Success criteria.** A user can select a prior description in one tap without
changing the amount, payer, or split. No new backend data model is required.

## 10. Expense search and filters

**Problem.** A long expense feed becomes difficult to inspect for a known cost,
a person's entries, or unresolved disputes.

**Solution shape.** Add client-side description search and a flagged-only
filter first. Add payer filtering only if the simpler controls prove useful.

**Success criteria.** A user can find matching expenses or show only flagged
ones without changing any underlying trip data. An empty result explains that
no expenses match the active criteria.

## 11. Flagged-expense visibility

**Problem.** A flag is visible only on the individual feed row, so an unresolved
dispute can be missed unless someone scrolls to that expense.

**Solution shape.** Surface an active-trip count and direct link when one or
more expenses are flagged. Reuse already fetched expense data; do not create a
second dispute state.

**Success criteria.** Any member can see that a trip has outstanding flagged
expenses from a high-visibility trip surface and reach the affected expense in
one tap.

## 12. Weighted splits

**Problem.** Equal and exact-dollar custom splits do not make proportional
costs quick to enter, such as one person having two drinks while everyone else
has one.

**Solution shape.** Add a third split mode where each included participant has
an integer weight (for example, 1× or 2×). Convert weights to stored integer
cent shares using a documented deterministic leftover-cent rule.

**Success criteria.** Weights always produce positive shares summing exactly to
the expense amount. Existing equal and custom split behavior is unchanged, and
the mode does not require itemized receipts.

## 13. Per-person spending summary

**Problem.** Balances explain who owes whom, but they do not answer simple
trip questions such as who has paid the most or total spending by person.

**Solution shape.** Add a compact summary based on existing expense data that
separately shows amount paid and net balance. Do not conflate paid spend with
what a person ultimately owes.

**Success criteria.** The totals reconcile to all recorded expenses and clearly
label paid versus net amounts. No new money calculations are persisted.

## 14. Link regeneration and revocation

**Problem.** A leaked invite slug remains a valid trip capability indefinitely.
Members need a way to stop new access through a compromised or outdated link.

**Solution shape.** Let an authorized trip owner replace the share slug and
invalidate the old one. Existing claimed members retain access through their
anonymous session; the UI clearly warns that the newly generated link must be
re-shared.

**Success criteria.** The prior slug no longer returns a join view after
regeneration. Existing members can still open the trip, and the new link is
easy to share immediately.

## 15. Stricter permissions and audit trail

**Problem.** Under the current friends-trust model, every trip member can edit
or delete any expense without a durable history. This becomes risky for larger
or less familiar groups.

**Solution shape.** Add explicit authorization rules for edits and deletes,
plus an append-only record of material changes. Define the policy before
building—such as creator-only deletion, creator override, or author ownership.

**Success criteria.** Users can tell who changed a financial record and when.
Unauthorized edits are rejected by database policy, not merely hidden in the
UI.

## 16. Anonymous-to-account upgrade

**Problem.** Device-bound anonymous identity is frictionless but vulnerable to
lost devices and storage resets.

**Solution shape.** Allow an existing anonymous Supabase identity to attach a
real sign-in method without losing its claimed participant memberships or
history. Preserve the no-account default for new users.

**Success criteria.** An upgraded user retains access to the same claimed trips
after signing in on another device. Anonymous onboarding remains fully usable.

## 17. Multi-currency

**Problem.** USD-only assumptions make the app unsuitable for international
trips or trips with shared costs in more than one currency.

**Solution shape.** Treat this as a future redesign, not a display toggle:
define how each expense records a currency, how exchange rates are selected and
audited, and what single currency settlement uses.

**Success criteria.** The model prevents ambiguous conversions and preserves
integer minor-unit calculations for every supported currency. Do not begin
implementation without a validated demand signal and a full money-model spec.
