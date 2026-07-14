# GroupTab

Split group-trip expenses. No accounts, no paywall, no app install — a trip link is the invite.

**Live:** https://bmeetze.github.io/grouptab/

- Create a trip, share the link, friends claim their names.
- 3-tap expense entry; equal, subset, or custom splits (integer cents, no float math).
- Settle up: minimized transfer list, DRAFT until everyone says "all my expenses are in".
- CSV export = backup. Supabase free tier + GitHub Pages = $0/month.

## Stack
React (Vite, TS) PWA · Supabase (Postgres, Realtime, anonymous auth, RLS) · GitHub Pages.
Schema + RLS + RPCs: `supabase/schema.sql`. Design spec and handoff live in the owner's workspace.

## Develop
```
npm install && npm run dev      # http://localhost:5173/grouptab/
npx vitest run                  # unit tests — money math (13), format (2), CSV (3) = 18
node scripts/rls-check.mjs      # access isolation against live Supabase (7 checks)
npx playwright install chromium # one-time browser install
npx playwright test             # E2E happy path against localhost:5173 (starts the dev server)
npm run build                   # typecheck + production build
```
