# GroupTab — Feature Roadmap Briefs

These briefs describe the next product opportunities identified in a usability
review. They are intentionally concise: use the product spec as the source of
truth for existing behavior, and turn an accepted brief into a detailed
implementation plan before building it.

## Recommended priority

| Order | Feature | Why now |
|---:|---|---|
| 1 | Explicit creator identity | Prevents the most damaging early mistake: attaching a device to the wrong person. It is a small change with a large trust benefit. |
| 2 | Native sharing and invite entry | Directly improves the two ways a trip grows or is recovered: inviting friends and returning without the original message. It also supports the landing page. |
| 3 | Landing page and “Your trips” home | Gives GroupTab a clear front door for new users and a dependable return path for existing users once joining is available from Home. |
| 4 | Settlement ledger, confirmation, and correction | Makes the financial record safe to rely on. Build this before adding richer payment handoff features, so payment status has an auditable source of truth. |
| 5 | Payment handoff | Removes the final coordination step after a transfer is calculated. Its value is highest once settlement records are trustworthy. |
| 6 | Claim recovery and participant management | Important resilience work, but the simplest current release-claim workflow covers many small-group cases. Design carefully because identity and historical money data are involved. |
| 7 | Coordination reminders | Useful for moving groups to completion, but it depends on sharing and is not required for the core expense-and-settlement loop. |
| 8 | Expense date editing | A worthwhile data-quality improvement that does not block a group from creating, sharing, recording, or settling a trip. |

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
Before recording it, confirm payer, recipient, and amount. Support optional
method and note fields; record who logged it and when. Show transactions in a
chronological history and make corrections explicit (for example, a reversal or
void entry), rather than silently changing history.

**Success criteria.** Every recorded payment is auditable and visibly explains
its impact on balances. Users can correct an accidental payment without
rewriting the record. Closing a trip remains based on balances derived from the
ledger.

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
