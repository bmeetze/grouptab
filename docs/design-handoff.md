> **Repo mirror** of the design handoff README. Path translations for this repo: `GroupTab Prototype.dc.html` → [prototype.html](prototype.html) (open it in a browser and click through every flow); the product spec → [spec.md](spec.md); `GroupTab Wireframes.dc.html` (exploration history, context only) lives only in the owner's workspace. Where this document and the spec disagree, **the spec wins** — known deliberate difference: the payer picker on Add expense is in the spec but not the prototype.

# Handoff: GroupTab — Group Trip Expense Splitter

## Overview

GroupTab is a mobile-first web app for splitting expenses on group trips. This handoff covers the complete v1 UI: home (trip list), create trip, join/claim name, trip screen (expense feed), add expense, expense detail, people (claim management), and settle up — including the full settle lifecycle (draft → all-in/final → paid → closed) and offline/closed states.

The product spec (data model, money rules, architecture: React PWA + Supabase) lives in the project spec (`../grouptab-design-spec.md`) — the single source of truth; where it and this package disagree, the spec wins. This package covers the **design and behavior**; implement against that spec's stack — React (Vite) PWA, Supabase Postgres/Realtime/anonymous auth.

## About the Design Files

The files in this bundle are **design references created in HTML** — they show intended look and behavior, not production code to copy. Your task is to **recreate these designs in the real codebase** (React + Vite per the spec) using proper components, routing, and Supabase data. The prototype's logic (split math, debt simplification) is deliberately correct and can be ported nearly as-is.

- `GroupTab Prototype.dc.html` — **primary reference.** A working interactive prototype: open it in a browser and click through every flow. All visual specs below match it. Its embedded `class Component` script contains reference implementations of the money math.
- `GroupTab Wireframes.dc.html` — the exploration history (wireframes + hi-fi style studies). Useful for context only; where it disagrees with the prototype, the prototype wins.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, and copy in the prototype are final ("Trailhead" visual system). Recreate pixel-faithfully at 1x for a 430px-wide mobile viewport; the app should be responsive from 320–430px and centered with the desk background beyond that.

## Design Tokens (Trailhead)

Typography — `Instrument Sans` (Google Fonts), weights 400/500/600/700. System fallback: sans-serif.

| Token | Value | Use |
|---|---|---|
| bg | `#f4f6f4` | App background |
| surface | `#ffffff` | Cards, inputs, tab bar |
| ink | `#16241d` | Primary text |
| ink-soft | `#5c6d64` | Secondary text |
| ink-faint | `#8a978e` | Tertiary/hints |
| disabled | `#b9c2bb` | Disabled buttons/icons |
| border | `#e2e8e3` | Hairlines |
| border-strong | `#d3dcd6` | Input borders, chips |
| accent | `#1f6f54` | Primary actions, positive balances, active tab |
| accent-tint | `#e3efe9` | Success ribbons/badges |
| negative | `#b4653a` | Owing amounts, destructive text (never pure red) |
| negative-bar | `#c98a4b` | Negative balance bars |
| warn | `#a06b1f` on `#f4e8d0` | Flag badges, draft badge, conflict banners |
| dark | `#16241d` | Toasts, offline banner |

Avatar colors (initial circles): Brandon `#c7ddd2`/`#1f6f54`, Jake `#e6d9c5`/`#8a6a3b`, Maya `#d9cfe8`/`#5b4a78`. Generate similar low-chroma pastel bg + darker fg pairs per participant (deterministic by index).

Type scale: balance hero 34/700 (letter-spacing −0.5px); amount entry 40/700; screen title 15–17/600–700; card title 14.5/600; body 13; meta 12/`ink-soft`; hints 11–11.5/`ink-faint`; section labels 11/600, letter-spacing 1px, uppercase, `ink-faint`.

Spacing & shape: screen padding 20–24px; card padding 12–16px; gap between cards 9–10px; radii — cards/inputs 14–18px, buttons 16–18px, chips/pills 12–16px, avatars 50%. Card shadow `0 1px 2px rgba(22,36,29,.05)`; FAB shadow `0 6px 16px rgba(31,111,84,.4)`. Toast: dark pill, bottom-centered, radius 14, auto-dismiss ~2.4s.

## Screens

### 1. Home
- App title "GroupTab" (20/700).
- **Active trip hero card**: accent-green bg `#1f6f54`, radius 24, white text. Contains: label "HAPPENING NOW" (11/600, ls 1.2, `#a8d4c2`), trip name (18/700, navigates to trip), your net balance (34/700, signed: `+$84.00`), avatar row + "$X spent" (`#a8d4c2`), and a white quick-add button "+ Add expense" (accent text, radius 16) that deep-links to Add.
- "OTHER TRIPS" section: white rows with trip name + your net (negative in `#b4653a`); closed trips at 55% opacity with 🔒 and "settled".
- Dashed-border "+ New trip" button.
- Only trips this device has claimed a name in appear here.

### 2. Create trip
- Back arrow + "New trip" header.
- Headline "Name the trip." (28/700). Trip-name input (accent border, radius 16).
- "Who's coming? Commas are fine." — a single text input; **comma-separated names become chips live as you type**. First chip is auto-claimed as "you" (solid accent chip, "· you ✓"); others are outline chips.
- Primary button "Create & copy link" — creates the trip, copies the share URL (`/t/<slug>`), navigates into it. Footer: "No accounts. The link is the invite."

### 3. Join / claim (link landing when device has no claim)
- Caption, "You've been invited to" + trip name (28/700), "Which one are you?"
- One row per participant: avatar + name. Unclaimed rows have a 2px accent border and "that's me →"; claimed rows are 55% opacity with "claimed ✓".
- Tapping an unclaimed name claims it (anonymous Supabase session) and enters the trip. **Claim conflict** (uniqueness race): toast «"Maya" was just claimed on another device — pick again» and the row flips to claimed.
- Footer: "No signup. This device remembers you from now on."

### 4. Trip (expense feed)
- Header: ← (home), trip name, 👥 chip (People screen), "share ↗" chip (copies link, toast "Link copied — …").
- Net balance (34/700): positive `#1f6f54` "you're owed", negative `#b4653a` "you owe", zero grey "you're even". Sub-line: "· $X trip total".
- Feed: newest first, white cards — payer avatar, title (one line, **truncate with ellipsis, never wrap**), meta "Payer · split · when" (also truncated), amount right-aligned 15/700. Flagged expenses show a compact `⚑` amber chip after the title (icon only, no word).
- FAB: 56px accent circle "+", bottom-right, overlapping tab bar.
- Tab bar (persistent on Trip and Settle): **⌂ Home | Expenses | Settle up** — active tab accent/700, inactive `ink-faint`.
- Live updates: new expenses from others appear within ~1s (Supabase Realtime).

### 5. Add expense (the 3-tap path)
- ✕ closes. Amount display 40/700 (`$48.00`).
- **Description is required**: input placeholder "What for? (required)", border turns accent when non-empty; Save stays disabled (grey `#b9c2bb`) until amount > 0 AND description non-empty.
- Split card: "Paid by **You**" + a mode chip "Split equally ⇄" toggling equal/custom. **Spec addition not in the prototype:** "Paid by You" is tappable and opens a participant picker, so an expense someone else paid can be logged on their behalf.
  - Equal: 44px avatar circles, in-split = accent ring, excluded = greyed at 60% (tap toggles; minimum 1). Right label: live "$24.00 each".
  - Custom: per-included-person `$` inputs with a live validator line — "$x of $y assigned" (amber) → "adds up to $y ✓" (green). Save blocked until the sum equals the total exactly.
- On-screen keypad: 3×4 grid (1–9, ., 0, ⌫), fixed 52px rows anchored to the bottom (never stretched). White keys, radius 16, 22/500. **Physical keyboard also works**: digits, `.`, Backspace, Enter = save.
- Save: creates the expense, toast "Added $X", returns to feed. Saving resets the **logger's own** "all in" flag — the person who saved it, not the payer (see Settle). Edits never reset anyone.

### 6. Expense detail
- Header: ←, "Expense", "✎ edit".
- Amount (32/700), title, "paid by X · when". Edited expenses show an "edited" marker next to the title.
- Flag: if flagged, amber banner "⚑ Flagged by X" with a **Resolve** button (anyone can resolve); if not, a quiet outline button "⚑ Flag for review".
- Split card: "SPLIT · EVERYONE" label, one row per person with exact cents (e.g. $133.34 / $133.33 / $133.33) and hint "leftover cents go to the payer".
- Comments: white bubbles "**Name** — text" (author name colored), input + accent send circle.
- Delete: quiet `#b4653a` text link → inline confirm card ("Delete this expense?" Cancel / solid Delete). Deleting returns to feed.

### 7. People (claim management)
- Reached via 👥 in the trip header. One row per participant: avatar, name ("(you)" suffix), status "claimed ✓" (accent) or "unclaimed" (grey).
- **Release my claim** (outline, `#b4653a`) on your own row → releases and drops you to the Join screen to re-claim.
- The **trip creator** additionally gets "Release" on everyone's rows (lost phone / wrong pick). Hint: "Anyone can release their own name; the trip creator can release anyone's."

### 8. Settle up — the lifecycle
**State 1 — collecting (default):**
- "All my expenses are in" card (accent border): title + subtitle "flip this when you've logged everything", iOS-style toggle (accent when on), and an avatar status row (checked = accent ring + ✓) with "2 of 3 in · waiting on Jake".
- Balance graph card: per person, name + horizontal bar diverging from a center zero line (positive accent right, negative `#c98a4b` left, width proportional to |balance|, min 8%) + signed amount.
- "Transfers" section with badge **DRAFT — may change** (amber); transfer cards at ~72% opacity, Mark-paid buttons outline style. Cards: "Jake pays **Brandon**" + amount 19/700. Transfers are the minimized list from greedy debt simplification — computed on the fly, never stored.
- Dashed placeholder: "Close trip — available when everyone's at $0".

**State 2 — everyone's in:**
- Toggle card collapses to a slim `#e3efe9` ribbon "Everyone's in ✓ — these numbers are final" (with a small "undo" link). Badge becomes **FINAL** (green); transfer cards full opacity; Mark-paid buttons go solid accent.
- Logging a new expense resets the **logger's** all-in flag (not the payer's; edits reset no one) and returns to State 1.

**State 3 — all paid:**
- Marking paid records a settlement and recomputes balances; paid transfers disappear from the list and appear under "Payment history" (65% opacity, "paid ✓").
- When every balance is $0: balances are replaced by a centered "All squared up" card (✓ roundel, "$X across N expenses, settled in M transfers.") and a solid **Close trip 🔒** button appears. Closing makes the trip fully read-only.

### 9. Global states
- **Offline**: dark banner "⚠ You're offline — showing last synced data" on Trip/Settle; FAB, Save, and Mark paid are blocked with toast "You're offline — writes are disabled"; failed saves show a retry affordance. Reads come from cache.
- **Closed trip**: `#e3efe9` ribbon "🔒 Trip closed · read-only"; no FAB; all writes disabled; CSV export still available.
- **Toasts** are the universal feedback: dark pill, bottom-center, ~2.4s.

## Money Rules (must match exactly — see spec doc)

- All amounts as **integer cents**; no floats in money math.
- Equal split: `base = floor(total/n)`; leftover cents go to the **payer** if in the split, else the first split participant. Store computed per-person cents even for equal splits.
- Custom splits must sum exactly to the total (validated at save; UI blocks otherwise).
- Balance = paid − shares + settlements sent − settlements received (sending a payment moves your balance toward zero; matches the prototype's `balances()`).
- Transfer list = greedy debt simplification (largest creditor × largest debtor), computed on the fly, ≤ n−1 transfers. Reference implementations: `computeSplit`, `balances`, `transfersFrom` in the prototype's script.

## State Management

Per the spec's six tables (trips, participants, expenses, expense_shares, comments, settlements), including **`all_expenses_in` boolean on participants** (reset to false whenever that participant logs a new expense) and **`flagged_by_participant_id` on expenses** (backs the "Flagged by X" banner). Client state: current claim (anonymous auth uid ↔ participant), current trip, add-expense form (amount string, description, split mode, split members, custom amounts), and realtime subscription state. Persist claim per device; balances and transfers are always derived, never stored.

## Interactions & Motion

- Screen transitions: fade+rise ~180ms ease-out.
- Toggle knob: 150ms. Toasts: 180ms in, auto-dismiss 2.4s.
- All tap targets ≥ 44px. No hover-dependent functionality (mobile-first); cursor:pointer on interactive elements for desktop.

## Assets

None — no images or icon fonts. Glyphs are unicode text (⚑ ✓ ⌫ 👥 ⌂ 🔒 ↗). Font: Instrument Sans via Google Fonts (self-host for the PWA).

## Files

- `GroupTab Prototype.dc.html` — interactive hi-fi prototype (primary reference)
- `GroupTab Wireframes.dc.html` — exploration history (context only)
