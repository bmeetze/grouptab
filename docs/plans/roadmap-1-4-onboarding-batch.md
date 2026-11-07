# Implementation plan — roadmap items 1–4 (onboarding & friction batch)

**Status:** proposed, not started. **Scope:** roadmap priorities 1–4 —
explicit creator identity, native sharing + invite entry, description
suggestions, flagged-expense visibility.

**Why these four together.** They are the top of the roadmap's priority table
and they share one property that makes them a clean release: *none of them
needs a schema change*. No `supabase/schema.sql` edit, no migration file, no
dashboard paste step by the owner, no new RLS surface, and therefore no
`scripts/rls-check.mjs` extension. Every change lands in `src/`. The next item
down the list (#5, settlement ledger) is the opposite on all counts, which is
the natural seam to cut at.

Verified against the code before writing this: `create_trip` already takes
`p_your_name` and resolves the claim by name (`supabase/schema.sql:134-152`),
so item 1 is a client-only fix; `data.expenses` already carries `description`
and `flagged` for every expense (`src/lib/types.ts:4`), so items 3 and 4 need
no new fetch.

---

## Task 1 — Explicit creator identity

**Roadmap §1.** Today `CreateTrip.tsx:31` hardcodes `names[0]` as the creator
and the UI asserts it with a `· you ✓` chip on the first name. A creator who
types `"Jake, Maya, Me"` silently claims *Jake*, and the only recovery is the
release-claim flow on the People screen.

### Changes

**`src/screens/CreateTrip.tsx`** — the whole task lives here.

1. Add `const [youName, setYouName] = useState<string | null>(null)`.
2. Reconcile on every `names` change: if `youName` is no longer in `names`
   (the creator edited the text field), clear it to `null`. Do this in the
   existing `useMemo` chain or a derived value — `const you = youName && names.includes(youName) ? youName : null` is simpler than an effect and avoids a render-loop.
3. Turn the existing chip row into a selection control. Each chip becomes a
   `<button>` (≥44px both axes per the conventions) that sets `youName`. The
   selected chip keeps today's accent fill + `· you ✓`; unselected chips use
   the neutral `.chip` style. Keep the row above a short prompt: **"Which one
   is you?"**
4. `canCreate` gains `&& you !== null`. Until a chip is picked, the primary
   button stays disabled — this is what makes the identity *explicit* rather
   than defaulted.
5. Pass `you` instead of `names[0]` to `createTrip(...)`.

**No default selection.** Auto-selecting the first name and letting the user
change it would satisfy the letter of the brief but not its intent: the
failure mode is a creator who doesn't *notice* the assumption. Requiring one
tap is the point. The cost is one extra tap on the happy path, on a screen
used once per trip.

**Backend: none.** `create_trip` validates `p_your_name` is among `p_names`
and claims by name match. Names are de-duplicated client-side by the existing
`new Set(...)` (`CreateTrip.tsx:15`) and `participants` has a
`unique (trip_id, name)` constraint, so the name→participant match is
unambiguous. `creator_participant_id` is set from the claimed row
(`schema.sql:150`), so it follows the selection automatically — which is
exactly the second half of the brief's success criteria.

### Tests

- **E2E must be updated.** `e2e/happy-path.spec.ts:6` comments "creator
  auto-claims the first name in the list" and fills `Erin, Sam` then clicks
  Create. With this change the button is disabled until a chip is tapped, so
  the spec needs `await page.getByRole('button', { name: /^Erin/ }).click()`
  before the Create click. This is the only existing test that breaks.
- No new unit test: this is presentation state, and the money core is untouched.

### Success criteria (from the brief)

Creator sees and confirms the identity before submitting ✓ (disabled button
until chosen). Selection, not list position, becomes the claimed participant
and `creator_participant_id` ✓ (passed as `p_your_name`).

---

## Task 2 — Native sharing and invite entry

**Roadmap §2.** Two independent halves; both are needed for the brief.

### 2a. Web Share API

Two call sites copy a link today: `TripFeed.onShare` (`TripFeed.tsx:41-46`)
and `CreateTrip.onCreate` (`CreateTrip.tsx:32-35`).

**New `src/lib/share.ts`** — one helper so both behave identically:

```
shareTrip(url, tripName) -> 'shared' | 'copied' | 'failed' | 'cancelled'
```

- If `navigator.share` exists, call it with `{ title, text, url }` inside a
  `try`. Resolve → `'shared'`.
- **`AbortError` → `'cancelled'`**, and the caller shows *no toast*. This is
  the detail that gets missed: dismissing the iOS share sheet rejects the
  promise, and treating that as an error means every cancelled share pops a
  spurious "couldn't share" message.
- Any other rejection → fall through to `navigator.clipboard.writeText` →
  `'copied'`, else `'failed'`.
- No `navigator.share` → clipboard path directly.

**Gesture constraint.** `navigator.share` must be invoked from a user
activation. In `TripFeed.onShare` the helper is the first `await` in the click
handler, so this is fine. In `CreateTrip` it is *not*: the share would follow
`await createTrip(...)`, and Safari may have consumed the activation by then.
Two options — recommend the first:

1. **Keep CreateTrip on clipboard-only** (today's behavior, today's copy) and
   let the user share from the trip header, which is one tap away and is the
   surface the toast already points at. Zero risk.
2. Navigate to the trip first and auto-open the share sheet there — rejected:
   an unprompted system sheet on arrival is worse UX than a button.

**`TripFeed.tsx`** — `onShare` calls the helper and maps the result to the
existing toast strings, adding a "Link shared" case and the silent
`'cancelled'` case.

### 2b. "Join a trip" entry point

**New `src/screens/JoinTrip.tsx`**, routed at `/join` in `App.tsx`, reachable
from Home (see Task 5 note below — the Home surface is roadmap #6; until then,
add the entry point to the existing empty-state and the trip-list footer).

- One text input (`inputMode` default, `autoCapitalize="none"`,
  `autoCorrect="off"` — slugs are hex and autocapitalize corrupts pasted
  text), plus an "Open trip" button.
- **Parsing** in a pure, unit-testable helper `parseInvite(raw): string | null`
  in `src/lib/share.ts`:
  - Trim. Accept a bare slug matching `/^[0-9a-f]{16}$/`.
  - Accept a URL: parse with `new URL()` (inside try/catch), take the
    pathname, match `/\/t\/([0-9a-f]{16})(?:\/|$)/`, return the capture.
    Accept **any origin** — people paste links from staging, from a shortener
    preview, or with tracking params — the slug is the capability, the host is
    not.
  - Anything else → `null` → inline error: **"That doesn't look like a
    GroupTab invite link."**
- On a valid parse, `navigate(`/t/${slug}`)`. TripGate then does the real
  work: a well-formed but non-existent slug hits the existing
  `Trip not found. Check the link.` branch (`TripGate.tsx:15`).

**Security constraint honored.** The slug shape is validated locally but
*existence* is never probed before navigation, so the join screen itself
reveals nothing. The 16-hex-char format is unchanged (`gen_random_bytes(8)`,
64 bits — `schema.sql:7`); no short code is introduced.

### Tests

- **New `src/lib/share.test.ts`** — `parseInvite` table test: bare slug;
  full production URL; URL with `?utm=` and with a trailing path segment
  (`/t/<slug>/settle`); `localhost:5173` URL; uppercase hex (reject — the
  column stores lowercase, and accepting it would 404 confusingly); 15- and
  17-char slugs; a non-GroupTab URL; empty string; whitespace-padded slug.
- `shareTrip` itself is thin and browser-API-bound — cover it in the E2E's
  clipboard path (already exercised) rather than mocking `navigator.share`.

---

## Task 3 — Description suggestions

**Roadmap §9, priority 3.** Cheapest item in the batch and entirely local.

### Changes

**`src/screens/AddExpense.tsx`, inside `ExpenseForm`.** The form already
receives the full `data` (`TripData`), so every prior description is in hand.

1. Derive once with `useMemo` over `data.expenses`: unique descriptions,
   most-recent-first. `data.expenses` already arrives sorted
   `created_at desc` (`api.ts:42`), so a `Set` insertion-order pass preserves
   recency for free. Exclude the expense being edited (compare on
   `initial?.description`) so an edit doesn't suggest its own value back.
2. Filter as the user types: case-insensitive `startsWith` first, then
   `includes`, capped at **4** suggestions. Show nothing when `descDraft` is
   empty *or* when the only match equals what's already typed.
3. Render as a horizontal chip row directly under the description input.
   Tapping one calls `setDescDraft(s)` only — amount, payer, split, and mode
   are untouched, which is the brief's explicit success criterion.
4. Chips are buttons ≥44px. Note the existing global `Enter` handler
   (`AddExpense.tsx:181-186`) already bails when the target is inside a
   `button`, so a focused chip activates rather than saving — no change needed
   there, but don't regress it.

**Deliberately not** a native `<datalist>`: it renders inconsistently across
mobile browsers and can't be styled to the Trailhead system.

### Tests

- **New unit test** for the extracted pure function
  `suggestDescriptions(expenses, draft, excludeId?)` in `src/lib/` — this is
  the only part worth testing and keeping it pure keeps it out of the
  component. Cases: recency order, de-duplication, case-insensitive prefix
  before substring, cap at 4, empty draft → `[]`, exact-match-only → `[]`.

---

## Task 4 — Flagged-expense visibility

**Roadmap §11, priority 4.** A flag is currently visible only on its own feed
row (`TripFeed.tsx:104-109`) and on the detail screen.

### Changes

**`src/screens/TripFeed.tsx`** — derive `const flagged = expenses.filter(e => e.flagged)`
(no fetch; `flagged` is already on every expense).

When `flagged.length > 0`, render a banner between the balance hero and the
expense list:

- **One flagged:** links straight to `/t/${slug}/e/${flagged[0].id}` — the
  brief's "reach the affected expense in one tap", exactly.
- **More than one:** shows the count and links to the first; the full
  flagged-only filter is roadmap #10 and this banner is the natural place to
  wire it up when that lands. Note that in the code comment so the next change
  finds it.

**Styling:** reuse the warn tokens already used by the row badge
(`--warn-bg` / `--warn-fg`), not a new color, and not `--negative` (which is
reserved for owing). Structurally it mirrors the existing `Ribbon` component
but needs warn colors and a link — either extend `Ribbon` with a `tone` prop
or add a sibling. **Recommend extending `Ribbon` with `tone?: 'accent' |
'warn'`** defaulting to `accent`, so the closed-trip ribbon is untouched.

**Home surface: not in this task.** The brief says "a high-visibility trip
surface", and the trip feed is the one every member lands on. Adding a flag
count to the Home trip cards means `Home.tsx` (already doing an N+1
`fetchTripData` per trip, `api.ts:117-126`) grows another responsibility right
before roadmap #6 rewrites that screen. Do it there instead.

### Tests

- No unit test (pure presentation over existing data).
- **E2E extension** (optional, local-only): flag an expense from the detail
  screen, go back, assert the banner is visible and its link resolves. Worth
  it — the flag round-trip currently has no automated coverage at all.

---

## Sequencing

1. **Task 1** (creator identity) — self-contained, and it touches the E2E, so
   land it before other changes queue up behind that spec.
2. **Task 3** (description suggestions) — independent, no shared files.
3. **Task 4** (flag surfacing) — touches `TripFeed.tsx` and `components.tsx`.
4. **Task 2** (sharing + join) — last because 2a also touches `TripFeed.tsx`
   (avoid colliding with Task 4) and 2b adds a route and a Home entry point,
   which is the widest blast radius.

One commit per task, each independently green.

## Definition of green (per CLAUDE.md)

Every task: `tsc -b` clean, `npx vitest run` passing, `npm run build` clean.

- **Tasks 1, 2** touch user flows → run `npx playwright test` locally.
- **No task** touches anything database-adjacent → `scripts/rls-check.mjs`
  is not required, and no migration file is produced. If that stops being
  true for any reason, the schema workflow in CLAUDE.md applies in full.

## Spec and doc updates

`docs/spec.md` describes creator identity and the share flow, so Task 1 and
Task 2 are **behavior changes that need spec edits** — and per CLAUDE.md the
owner's workspace holds a mirror of the spec that this environment cannot
reach. Flag those edits explicitly at hand-off so the mirror gets synced.

Tasks 3 and 4 are additive UI over existing data and need only a short note
in the relevant spec sections.

## Explicitly out of scope for this batch

Settlement ledger (#5), Home/landing redesign (#6), payment handoff (#7),
expense search and filters (#10). Task 4's banner leaves the hook for #10 and
Task 2's join entry point will be re-homed by #6 — both are noted in the code
where they land.
