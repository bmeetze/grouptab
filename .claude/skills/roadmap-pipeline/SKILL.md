---
name: roadmap-pipeline
description: Work the open items on docs/roadmap.md through plan → owner approval → build → test. Opus (medium effort) subagents write feature docs and plans; Sonnet subagents implement and test approved plans. Use when the owner asks to work the roadmap, or from a /goal that names this skill.
---

# Roadmap pipeline

You are the orchestrator. You do not write feature code yourself. You read the
roadmap, dispatch subagents, hold the approval gate, and verify every result
before it is committed. CLAUDE.md and `docs/roadmap.md` govern; where this skill
and they disagree, they win.

Each roadmap item moves through four states. The state lives in the feature doc's
**Status** line, so the pipeline can resume in any session:

| State | Meaning | Who moves it forward |
| --- | --- | --- |
| *(no doc)* | Not started | Phase 1 planner |
| Designing | Doc + plan drafted; open questions may remain | Owner answers questions, then approves |
| Planned | Open questions empty **and** `**Approved:** YYYY-MM-DD by owner` present | Phase 2 builder |
| Building / Shipped | In code / merged into spec | Phase 3 verification |

**The approval gate is absolute.** Only the owner approves. Write the
`**Approved:**` line only when the owner, in this conversation, explicitly approves
that specific item's plan. Never infer approval from silence, from a /goal, or from
"looks good" about a different item. Never build an item without that line.

## Phase 0 — Read state

1. Read `docs/roadmap.md`, `docs/spec.md`, `docs/evals.md`, every file in
   `docs/features/` and `docs/plans/`.
2. For each open roadmap row (1–12, not Shipped), find its feature doc by name and
   classify it into one of the states above.
3. Print a one-line-per-item status table. Then run the phases below in order;
   each phase only touches items in the state it consumes.

## Phase 1 — Plan (Opus, medium effort)

For each item with no feature doc, spawn one `Plan`-type subagent with
`model: "opus"` and `effort: "medium"`. Respect dependencies: **#4 Payment handoff
plans after #1 Settlement ledger has a doc** and receives it as input; **#7
Anonymous-to-account upgrade plans after #5 Claim recovery**. Run independent
items in parallel, at most 4 at a time.

Planner prompt must include: the roadmap row and one-line brief, the doc-naming
rule (`features/NN-short-name.md` and `plans/NN-short-name.md`, NN = current
roadmap number, zero-padded), and these instructions:

- Read CLAUDE.md, spec.md, evals.md, the relevant `src/` files and
  `supabase/schema.sql` before designing. Ground every decision in current code.
- Feature doc follows the seven sections in roadmap.md's "Feature docs" section,
  modeled on `docs/features/01-multi-currency.md`. Status: `Designing`.
- Every decision that is genuinely the owner's (product policy, trade-offs with
  user-visible cost) goes under **Open questions**, each with 2–4 options and a
  recommendation. Decisions the code settles go under **Decisions** with the reason.
- Plan follows `docs/plans/01-multi-currency.md`: context, design in one paragraph,
  files to change, schema.sql edit + migration snippet if any, tests per acceptance
  criterion, which eval tiers must pass, risks.
- Preserve every invariant in CLAUDE.md. Flag explicitly if the design needs a new
  grant, RPC, or dashboard toggle.
- Planners write only their own two doc files. No code. No commits.

When planners return: read each doc yourself and reject any that violates an
invariant or contradicts spec.md (send it back with the reason). Then link each
new doc from its roadmap row's "Feature doc" column, commit the docs
(`docs: plan NN <name>`), and push.

## Phase 2 — Questions and approval (the owner)

For each item in Designing, ask its open questions with `AskUserQuestion` (up to
4 per call, recommendation first). Record each answer in the doc as a numbered
decision with today's date and "owner". If an answer changes the design, re-run
that item's planner (Opus, medium) with the new decisions before going further.

When an item's open questions are empty, show the owner a short summary (problem,
design paragraph, migration yes/no, risks) and ask for approval of that item. On
explicit approval: set Status to `Planned`, add the `**Approved:**` line, commit,
push. Items not approved stay Designing — skip them and continue.

## Phase 3 — Build and test (Sonnet)

Take Planned items **one at a time, in roadmap order** (they share `schema.sql`,
`money.ts` and screens; parallel builds would conflict). Before each, re-read the
plan against the current `main` — an earlier feature may have changed the ground.
If the plan is stale, send it back to Phase 1 instead of building.

1. **Implement** — spawn a `general-purpose` agent with `model: "sonnet"`. Prompt:
   the plan path, the feature doc path, CLAUDE.md's invariants and conventions
   verbatim, "follow the plan exactly; if the plan is wrong, stop and report — do
   not improvise a design", and "run `npm run eval` and `npm run build` until both
   are clean; do not commit". Set Status to `Building` when it starts.
2. **Test** — spawn a second, independent `general-purpose` agent with
   `model: "sonnet"`. Prompt: the acceptance criteria; write a test for each one
   not already covered (money rules get unit tests in tier 1); run
   `npm run eval`, `npm run build`, plus `npm run eval:e2e` if a screen or flow
   changed; report each criterion as passed / failed / untestable-with-reason.
3. **Verify yourself.** Run `npm run eval` and `npm run build`. Read the diff.
   Check it against the invariants (integer money, RPC-only writes, no widened
   grants without a new `rls-check.mjs` attack, ≥44px targets, tokens only,
   ref-locked writes). Do not trust an agent's "all green".
4. **Database changes.** If the plan has a migration, the feature cannot finish in
   one pass: dev machines have no SQL access. Commit with
   `(pending migration)` in the message, push, and tell the owner exactly which
   file in `supabase/migrations/` to paste into the Supabase SQL editor and any
   dashboard toggle. Leave Status `Building — awaiting migration`. When the owner
   confirms it is applied, run `node scripts/rls-check.mjs` and `npm run eval:live`
   before shipping.
5. **Ship** — per CLAUDE.md: merge the spec delta into `docs/spec.md`, set Status
   to `Shipped YYYY-MM-DD`, move the roadmap row to Shipped (renumber without
   reordering), commit, push. Do not open a pull request unless the owner asked.

If any step fails twice, stop that item, record the failure in the feature doc
under a **Blocked** note, and move to the next item.

## Ending a run

Finish with a status table: every open roadmap item, its state, and what it is
waiting on (owner answer, owner approval, migration to apply, or nothing — shipped).
A run is complete when no item can advance without the owner.
