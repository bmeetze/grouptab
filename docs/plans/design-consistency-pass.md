# Implementation plan — design consistency pass

**Status:** approved 2026-11-12, not started. The contrast fix (part of step 1)
already shipped with this plan. **Scope:** Phase 1, then Phase 2 as a separate
PR. The owner delegated the Phase 2 decisions; they are recorded below.

## Problem

The app has design tokens but no components. Each screen hand-rolls its own
buttons, headers and type through inline styles (224 `style={{…}}` blocks across
`src/screens/`), so they have drifted apart. Measured on `main` at `cc49efa`:

- 25 `<button>` elements use neither `.btn` nor `.chip`. "Mark paid", "Release my
  claim" and "Flag for review" render at font-weight 400; other buttons at 600.
- Four header layouts: left title (feed, People), centred title (detail, Add),
  no back control (Settle), ✕ (Add).
- Icons are Unicode glyphs and one emoji (`← ✕ 👥 ↗ ✎ ⚑ ⇄ ▾ ⌂ ↑ 🔒 →`), which
  render differently per platform. Only the Home tab has an icon.
- 20 distinct inline font sizes (9 … 34, including 12, 12.5, 13, 13.5, 14, 14.5).
- `tokens.css` has zero `:active`, `:focus-visible` or `transition` rules.
- Contrast: the disabled primary button label (`#fff` on `--disabled`) is
  1.83:1. (Text-token contrast was fixed with this plan — see step 1.)
- The lighter weight on "Mark paid" and friends is a bug: each sets `fontWeight`
  and then `font: 'inherit'` after it, which resets the weight.

## The one rule for Phase 1

**Appearance only. No behaviour, copy, layout order or data changes.** If a step
seems to need one, stop and raise it. The distinction to hold: Phase 1 changes
*how a control looks and responds*; Phase 2 changes *what a screen says*.

Guardrails, all enforced by `evals/invariants.test.ts` or CLAUDE.md:

- Write handlers and their `useRef` locks stay **in the screen files**, textually
  unchanged. The lock invariant matches source text per screen; moving a handler
  into a shared component breaks it.
- Closed-trip two-layer guards stay (hide the affordance **and** guard the handler).
- `.app-scroll` stays unpositioned. `max-width: 430px` stays. Colour token
  values stay as they are now; the contrast invariant must keep passing.
- Every interactive element keeps a ≥44px hit area on both axes.
- Hex literals live only in `src/ui/tokens.css`. Never widen `HEX_EXCEPTIONS`.

## Phase 1 — steps

Work on a feature branch. One commit per step; run `npm run eval` after each.

### Step 0 — Baseline screenshots (not committed)

Capture these nine states at 390×844 before touching anything, and again at the
end, for a before/after sheet in the PR: Home (empty), Create trip, feed (empty),
feed (3 expenses), expense detail, Add expense (empty), People, Settle, Home (one
trip). Drive it with a throwaway Playwright spec that reuses `e2e/helpers.ts`;
keep the spec and config out of the commit. Each run creates one permanent trip
in the live database (accepted, per CLAUDE.md).

### Step 1 — Tokens: type scale, contrast, motion

In `src/ui/tokens.css` `:root`:

- **Type scale.** Add `--text-xs: 11px` (caps labels), `--text-sm: 13px` (meta),
  `--text-md: 15px` (body, buttons), `--text-lg: 18px` (screen titles),
  `--text-xl: 22px`, `--text-2xl: 28px` (page headings), `--text-hero: 34px`
  (money headline), and `--text-input: 16px` (every `<input>`; below 16px iOS
  zooms on focus).
- **Contrast — text tokens already done.** `--ink-soft`, `--ink-faint`,
  `--negative` and `--warn-fg` were darkened and `--on-accent-soft` added (Home's
  hero label uses it; its `HEX_EXCEPTIONS` entry is gone). An invariant now
  asserts ≥4.5:1 for every text-token pair. Do not re-tune these.
- **Disabled button — still to do.** Add `--disabled-fg` and restyle disabled
  primary buttons as `--border` background with `--disabled-fg` text at ≥3:1,
  instead of white on grey. Add the pair to the contrast invariant at 3:1.
- **Motion.** `--ease: 120ms ease-out`.

### Step 2 — Icons

New `src/ui/icons.tsx`: hand-authored inline SVGs, no new dependency. One shape
language: 24×24 viewBox, `stroke="currentColor"`, `strokeWidth` 1.75, round caps
and joins, `fill="none"`, `aria-hidden="true"`, default render size 20px.

Set: `ArrowLeft`, `ArrowRight`, `Close`, `People`, `Share`, `Edit`, `Flag`,
`Swap`, `ChevronDown`, `Home`, `Receipt`, `Scale` (Settle tab), `Send`, `Lock`,
`Check`, `Plus`.

Replace every glyph in the list under "Problem". Rules:

- An icon-only control gets an `aria-label`; an icon beside text is decorative.
- `TabBar`: all three tabs get an icon above the label (Home, Receipt, Scale).
- `✓` inside sentence copy ("adds up to $30.00 ✓", "claimed ✓") is text, not an
  icon — leave it.
- Add an invariant: no file under `src/screens` or `src/ui` contains any of
  `← ✕ 👥 ↗ ✎ ⚑ ⇄ ▾ ⌂ 🔒`.

Accessible names change where a glyph was part of the name. Update the flow
evals in the same commit — known cases: `'✎ edit'` → `'Edit'`,
`'⚑ Flag for review'` → `'Flag for review'`, `getByText('⚑ Flagged by You')` →
`'Flagged by You'`, `'🔒'` in the closed ribbon (the spec matches the text after
it, so it should survive). Keep the FAB link's accessible name `'+'` **or**
rename to `'Add expense'` and update every `name: '+'` selector — pick one.

### Step 3 — Buttons

Components need pressed and focus states, so they are CSS classes, not inline
styles. Put them in a new `src/ui/components.css` imported after `tokens.css`,
and extend the hex invariant to scan it.

- `.btn` base: `min-height: 48px`, radius 16, `font: inherit`, weight 600,
  `--text-md`, `transition: transform var(--ease), background var(--ease)`,
  `-webkit-tap-highlight-color: transparent`.
  `:active:not(:disabled)` → `transform: scale(.98)`.
  `:focus-visible` → `outline: none; box-shadow: 0 0 0 3px var(--accent-tint)`.
- Variants: `.btn-primary` (accent fill), `.btn-secondary` (surface,
  `--border-strong` border, accent text — today's `.btn-outline`, renamed),
  `.btn-quiet` (no border or fill, `--ink-soft` text), `.btn-danger` (quiet, with
  `--negative` text — "Delete expense…", "Release my claim").
- Sizes: default is full-width 48px; `.btn-sm` is inline, `min-height: 44px`,
  padding `0 14px`, `--text-sm` ("Mark paid", "Release my claim", header actions).
- `.icon-btn`: 44×44, centred icon, same states.
- `.chip` keeps its shape and gains the same `:active` / `:focus-visible` rules.
- `.field:focus-within` already has the ring; make the Create trip, Join and
  comment inputs use `.field` so the browser's black outline goes away.
- Wrap the transition and transform in `@media (prefers-reduced-motion: no-preference)`.

Export a thin `Button` from `src/ui/components.tsx` (`variant`, `size`, rest
props spread onto `<button>`) so screens stop spelling class strings. Migrate
all 25 unclassed buttons plus existing `.btn` users.

Leave alone, on purpose: avatar toggle buttons in the split card, payer-picker
rows, currency chips, the Settle all-in switch. They are not "buttons" in this
vocabulary; they only gain the shared focus ring.

### Step 4 — Screen header

`ScreenHeader` in `src/ui/components.tsx`:
`{ title, back?: string /* route */, onClose?: () => void, action?: ReactNode }`.
Layout: 44px row; leading slot (back arrow link with `aria-label="Back"`, or
close button with `aria-label="Close"`, or empty); title left-aligned next to it
at `--text-lg`/700, single line with ellipsis; trailing slot for `action`.

Use it on every screen that has a header: TripFeed, ExpenseDetail, AddExpense
(both the form and the closed state, which duplicate the markup today),
CreateTrip, Join, JoinTrip, People, Settle. Settle gains nothing in the leading
slot (it is a tab root) but takes the same title style. Home keeps its wordmark.

The flow evals select `name: 'Back'` as a **link** and `name: 'Close'` as a
**button**; keep those roles and names.

### Step 5 — Type scale sweep

Replace every inline `fontSize: <number>` in `src/screens` and `src/ui` with a
`var(--text-*)` token. Map to the nearest step; when a value sits between two
steps, choose by role (meta → `sm`, body → `md`), not by rounding. Inputs always
`--text-input`. Watch the React inline-style trap already documented in
AddExpense: `font: 'inherit'` placed **after** `fontSize` silently wins.

Add an invariant: no `fontSize: <number literal>` in `src/screens` or `src/ui`.

### Step 6 — Docs

- `docs/design-handoff.md`: add a "Components" section (button variants and
  sizes, icon set and shape language, header, type scale, state rules) and fix
  per-screen notes that cite old sizes or glyphs.
- `docs/spec.md`: only where it quotes a glyph or label that changed.
- `CLAUDE.md` Conventions: buttons via `Button` variants, icons from
  `src/ui/icons.tsx` (never glyphs or emoji), sizes via `--text-*`, new buttons
  need no bespoke state CSS. Mirror into `AGENTS.md` if it carries the same text.
- `docs/evals.md`: describe the design invariants (contrast, glyphs, font sizes).

## Definition of done

- `npm run eval` and `npm run build` clean; `npm run eval:e2e` all green.
  In a cloud session the pinned Playwright cannot find its browser: run through
  a temporary config that sets
  `launchOptions.executablePath: '/opt/pw-browsers/chromium'`, and do not commit it.
- Invariants pass: token contrast (existing, extended for the disabled pair), no
  glyph icons, no literal font sizes.
- `HEX_EXCEPTIONS` has not grown.
- Before/after sheet of the nine states attached to the PR. Check each "after"
  for: one header style, one button weight, icons on all three tabs, a visible
  focus ring when tabbing on desktop, nothing clipped at 320px width.
- Desktop frame (1280×800) still anchors the tab bar, FAB and toast to the frame.

## Risks

- **Selector churn.** Flow evals match some controls by glyph-bearing names.
  Mitigation: change names and selectors in the same commit (step 2), never later.
- **Lock invariant.** It reads screen source text. Mitigation: `Button` takes
  `onClick` as a prop; handlers and refs do not move.
- **Large diff, every screen.** Mitigation: the step order makes each commit
  reviewable alone, and no step changes behaviour, so the flow evals are a true
  regression check throughout.
- **Subjective result.** "Looks better" has no test. Mitigation: the before/after
  sheet is the review artifact; the owner signs off on it, not on the diff.

## Not in scope

- `docs/prototype.html` is not updated. The handoff doc is the reference.
- Dark mode, loading skeletons, list motion.

## Phase 2 — what screens say (separate PR, after Phase 1 merges)

These change behaviour, so the PR also merges a spec delta into `docs/spec.md`
for each item, updates the handoff doc, and extends the flow evals. Decisions
were made on the owner's behalf on 2026-11-12; the reasoning is the record.

### 2a — Feed rows show your part

Under the total on each feed row, one line, in the expense's own currency:

| Situation | Line | Colour |
| --- | --- | --- |
| You paid | `you lent {amount − your share}` | `--accent` |
| Someone else paid, you are in the split | `your share {your share}` | `--ink-soft` |
| You paid and it nets to zero (only you in the split) | `just you` | `--ink-faint` |
| Neither paid nor in the split | `not in this one` | `--ink-faint` |

- "Your share" is deliberately not amber: amber means a net debt, and one row is
  not a net position.
- Derive from stored `shares` and `amountMinor` only — integer minor units, no
  new rounding. Put it in a pure helper in `src/lib/` with unit tests for all
  four rows, including a payer who is not in the split (lent = full amount).
- A foreign-currency row keeps its existing ≈USD estimate under the total; the
  new line sits in the row's meta line instead, replacing "split N ways".

### 2b — Date headings in the feed

Group rows under `Today`, `Yesterday`, then `Sat, Nov 7` (device locale and time
zone), newest group first. Group by the logged timestamp: it is the only date
stored, and roadmap #12 (incurred date) will change the key later. Headings use
`.section-label`. Rows drop the relative time when a heading already says it,
except under Today, where "2h ago" still helps.

### 2c — One balance headline

Feed and Home hero both read: label above, signed number below.
`you're owed` / `+$100.32` (accent), `you owe` / `−$31.00` (negative),
`you're even` / `$0.00` (`--ink-faint`). The trip total moves to its own line
under the number. Keep the label text lower-case in the DOM and upper-case it in
CSS: the flow evals wait on `getByText("you're even")` and `"you're owed"`, and
`createTrip` in `e2e/helpers.ts` depends on the first.

### 2d — Empty states

- **Empty trip feed:** heading "Start the tab", one line "Send the link so
  everyone can claim their name, then log the first expense.", and two buttons:
  "Share the link" (secondary; calls the existing share handler) and "Add the
  first expense" (primary; same route as the FAB). Hidden on closed trips.
- **Empty Home:** keep the copy and both buttons; move the block from the
  vertical centre to the upper third so it does not float. No illustration.

### 2e — Dashed outline means "add" only

Settle's unavailable Close trip becomes a centred line of `--ink-faint` text —
"Close trip unlocks when everyone's at $0" — with no box. It stays visible
because it tells the group what the end of the trip looks like. The enabled
state is a normal secondary button.

### Decided against — Create trip name chips

Not building. The comma field is the fastest way to enter a group, it accepts a
pasted list, and the screen already turns names into chips for the "which one
is you?" pick. Entering names one at a time would cost speed for no new clarity.

### Phase 2 definition of done

Same gates as Phase 1, plus: spec deltas merged, unit tests for 2a, and flow-eval
assertions for 2a (one row of each kind that the existing specs already create),
2b (a `Today` heading), 2d (the two empty-trip buttons) and 2e.
