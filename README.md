# GroupTab

Split group-trip expenses. No accounts, no paywall, no app install — a trip link is the invite.

**Live:** https://bmeetze.github.io/grouptab/

- Create a trip, share the link, friends claim their names.
- 3-tap expense entry; equal, subset, or custom splits (integer cents, no float math).
- Settle up: minimized transfer list, DRAFT until everyone says "all my expenses are in".
- CSV export = backup. Supabase free tier + GitHub Pages = $0/month.
- iOS tip: add GroupTab to your home screen *before* claiming your name — Safari and installed PWAs don't share storage, so claim from the installed app.

## Stack
React (Vite, TS) PWA · Supabase (Postgres, Realtime, anonymous auth, RLS) · GitHub Pages.
Schema + RLS + RPCs: `supabase/schema.sql`.

## Docs
- [docs/spec.md](docs/spec.md) — product spec: current behavior only (source of truth)
- [docs/roadmap.md](docs/roadmap.md) — prioritized roadmap, plus what's shipped
- [docs/features/](docs/features/) + [docs/plans/](docs/plans/) — design docs and implementation plans for features in active work
- [docs/design-handoff.md](docs/design-handoff.md) + [docs/prototype.html](docs/prototype.html) — Trailhead visual system and interactive pixel reference
- [docs/evals.md](docs/evals.md) — the standing correctness suite (three tiers, when to run each)
- [CLAUDE.md](CLAUDE.md) — working guide for AI agents (and humans): architecture, invariants, conventions, DB-change workflow, gotchas

## Develop
```
npm install && npm run dev      # http://localhost:5173/grouptab/
npm run eval                    # the gate: typecheck + money/amount/CSV units + repo invariants
npm run eval:live               # access isolation + write-RPC contracts against live Supabase
npx playwright install chromium # one-time browser install
npm run eval:e2e                # flow evals against localhost:5173 (starts the dev server)
npm run build                   # typecheck + production build
```
