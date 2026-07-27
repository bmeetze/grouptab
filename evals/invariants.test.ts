import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Invariant evals — the rules in CLAUDE.md, made executable.
//
// Every check here encodes a bug that was found (and fixed) during the build:
// a float in a money path, a table-level grant that let one member rewrite
// another's data, a hardcoded Supabase URL that drifted out of sync. Unit
// tests prove the code we have is right; these prove nobody quietly removed
// the guard rails. They read the repo as text, so they run anywhere, in
// milliseconds, with no database and no browser.
//
// A failure here is not a style nit. Read the check's comment before
// "fixing" it by widening the allowlist — the allowlist is the review record.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const srcFiles = walk('src').filter(f => /\.tsx?$/.test(f));
const appFiles = srcFiles.filter(f => !/\.test\.tsx?$/.test(f));
const screenFiles = appFiles.filter(f => f.startsWith('src/screens/'));
const schema = read('supabase/schema.sql');

/** Lines of a file, minus `//` comments, so prose about a pattern never trips a check. */
function codeLines(file: string): { n: number; text: string }[] {
  return read(file).split('\n')
    .map((text, i) => ({ n: i + 1, text: text.replace(/\/\/.*$/, '') }))
    .filter(l => l.text.trim().length > 0);
}

const hits = (files: string[], re: RegExp) =>
  files.flatMap(f => codeLines(f).filter(l => re.test(l.text)).map(l => `${f}:${l.n}: ${l.text.trim()}`));

// ---------------------------------------------------------------- money

describe('invariant: integer cents everywhere', () => {
  // The three files below are the only places money is allowed to touch a
  // float, and each is exhaustively unit-tested:
  //   lib/amount.ts — the typed-string ⇄ cents boundary (parseFloat + round)
  //   lib/format.ts — display formatting ($1,234.56)
  //   lib/csv.ts    — export formatting
  const FLOAT_MONEY_ALLOWED = ['src/lib/amount.ts', 'src/lib/format.ts', 'src/lib/csv.ts'];

  it('no float money math outside the three formatting/parsing files', () => {
    const candidates = appFiles.filter(f => !FLOAT_MONEY_ALLOWED.includes(f));
    // `/ 1000` (timeAgo's milliseconds) is deliberately not matched.
    expect(hits(candidates, /parseFloat|\.toFixed\(|[/*] ?100(?!\d)/)).toEqual([]);
  });

  it('the correctness core does no parsing, rounding, or float conversion', () => {
    expect(hits(['src/lib/money.ts'], /parseFloat|\.toFixed\(|Number\(|Math\.round/)).toEqual([]);
  });

  it('money.ts exports the three functions every displayed number derives from', () => {
    const core = read('src/lib/money.ts');
    for (const fn of ['computeEqualSplit', 'computeBalances', 'simplifyDebts']) {
      expect(core).toContain(`export function ${fn}`);
    }
  });

  it('balances and transfers are never persisted', () => {
    // If a column named like a stored balance ever appears, the "computed on
    // the fly, always consistent" guarantee is gone.
    expect(schema).not.toMatch(/\b(balance|balances|net_cents|owed_cents)\b/i);
  });

  it('every money column is a positive integer, never a decimal type', () => {
    // expenses, expense_shares, settlements each store amount_cents.
    const declarations = schema.split('\n')
      .filter(l => /^\s*amount_cents /.test(l));
    expect(declarations).toHaveLength(3);
    for (const col of declarations) {
      expect(col).toMatch(/integer not null check \(amount_cents > 0\)/);
    }
    expect(schema).not.toMatch(/\b(numeric|decimal|real|double precision|money)\b/i);
  });
});

// ------------------------------------------------------- write surfaces

describe('invariant: expense writes go through RPCs only', () => {
  const api = read('src/data/api.ts');

  it('expenses are inserted only via add_expense / update_expense', () => {
    expect(api).toContain("supabase.rpc('add_expense'");
    expect(api).toContain("supabase.rpc('update_expense'");
    expect(api).not.toMatch(/from\('expenses'\)[\s\S]{0,80}\.insert\(/);
  });

  it('expense_shares is never written from the client', () => {
    expect(hits(appFiles, /from\('expense_shares'\)/)).toEqual([]);
  });

  it('direct expense updates only touch the flag columns', () => {
    // The grant is column-scoped server-side; this keeps the client honest
    // so a widened grant is the only way this could ever regress.
    const updates = api.match(/from\('expenses'\)[\s\S]{0,120}?\.update\(\{[^}]*\}/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      const cols = [...u.matchAll(/([a-z_]+):/g)].map(m => m[1]);
      expect(cols.sort()).toEqual(['flagged', 'flagged_by_participant_id']);
    }
  });

  it('screens never reach past the api layer to the Supabase client', () => {
    expect(hits(screenFiles, /from '\.\.\/data\/supabase'/)).toEqual([]);
  });
});

describe('invariant: non-idempotent writes hold a synchronous ref lock', () => {
  // setState does not apply until the next render, so a state-only guard
  // lets a double-tap fire two RPCs — a duplicate expense, or a settlement
  // recorded twice (settlements have no uniqueness constraint).
  const NON_IDEMPOTENT = [
    'createTrip', 'addExpense', 'updateExpense', 'deleteExpense',
    'markPaid', 'closeTrip', 'addComment', 'addParticipant', 'setFlag', 'setAllIn',
  ];

  /** Refs guarding a write, identified by the documented shape:
   *  `if (…someRef.current…) return;` followed by `someRef.current = true`.
   *  Refs used for other purposes (Home's unmount `cancelledRef`) are not locks. */
  function writeLocks(text: string): string[] {
    return [...text.matchAll(/const (\w+Ref) = useRef\(false\)/g)].map(m => m[1])
      .filter(lock =>
        new RegExp(`if \\([^)]*${lock}\\.current[^)]*\\) return`).test(text)
        && new RegExp(`${lock}\\.current = true`).test(text));
  }

  it('every screen that calls one declares a guarded useRef lock', () => {
    const offenders: string[] = [];
    for (const file of screenFiles) {
      const text = read(file);
      const calls = NON_IDEMPOTENT.filter(fn => new RegExp(`\\b${fn}\\(`).test(text));
      if (calls.length > 0 && writeLocks(text).length === 0) {
        offenders.push(`${file} calls ${calls.join(', ')} with no ref lock`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a lock is never released on the success path inside its try block', () => {
    // Two shapes are allowed: release in `finally` (the UI stays put, so the
    // lock must span the refetch), or release only in `catch` when success
    // navigates away. Releasing inside `try` after the await re-opens the
    // double-fire window this pattern exists to close.
    const offenders: string[] = [];
    for (const file of screenFiles) {
      const text = read(file);
      for (const lock of writeLocks(text)) {
        const releases = [...text.matchAll(new RegExp(`${lock}\\.current = false`, 'g'))];
        if (releases.length === 0) { offenders.push(`${file}:${lock} is never released`); continue; }
        for (const r of releases) {
          const before = text.slice(0, r.index);
          const lastTry = before.lastIndexOf('try {');
          const lastHandler = Math.max(before.lastIndexOf('catch ('), before.lastIndexOf('finally {'));
          if (lastHandler < lastTry) offenders.push(`${file}:${lock} released inside try`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('invariant: closed trips are read-only', () => {
  it('the server rejects writes to a closed trip in every write RPC', () => {
    for (const fn of ['add_expense', 'update_expense', 'add_participant']) {
      const body = schema.slice(schema.indexOf(`function public.${fn}(`));
      expect(body.slice(0, body.indexOf('$$;'))).toMatch(/trip_is_active/);
    }
  });

  it('insert/update/delete policies on trip content require an active trip', () => {
    for (const policy of [
      'exp_member_update', 'exp_member_delete', 'comments_own_insert', 'settle_member_insert',
    ]) {
      const at = schema.indexOf(policy);
      expect(at, `${policy} missing from schema.sql`).toBeGreaterThan(-1);
      expect(schema.slice(at, schema.indexOf(';', at))).toMatch(/trip_is_active/);
    }
  });

  it('screens guard the handler, not just the affordance', () => {
    // Hiding a button is not a guard: the route is still reachable by URL.
    expect(read('src/screens/AddExpense.tsx')).toMatch(/status === 'closed'/);
    expect(read('src/screens/Settle.tsx')).toMatch(/if \(closed \|\|/);
  });
});

// ------------------------------------------------------------- database

describe('invariant: database access model', () => {
  it('row-level security is enabled on all six tables', () => {
    for (const t of ['trips', 'participants', 'expenses', 'expense_shares', 'comments', 'settlements']) {
      expect(schema).toContain(`alter table public.${t} enable row level security;`);
    }
  });

  it('table-level UPDATE is revoked and re-granted column by column', () => {
    // Table-wide grants were a real privilege-escalation hole: they let any
    // member re-parent a participant row, or reassign a trip's creator.
    const scoped: [string, string][] = [
      ['trips', 'status'],
      ['participants', 'all_expenses_in'],
      ['expenses', 'flagged, flagged_by_participant_id'],
    ];
    for (const [table, cols] of scoped) {
      expect(schema).toContain(`revoke update on public.${table} from anon, authenticated;`);
      expect(schema).toContain(`grant update (${cols}) on public.${table} to authenticated;`);
    }
  });

  it('expenses and expense_shares have no INSERT policy at all', () => {
    for (const table of ['expenses', 'expense_shares']) {
      const re = new RegExp(`create policy \\w+ on public\\.${table} for insert`, 'i');
      expect(schema).not.toMatch(re);
    }
  });

  it('expense_shares has no direct write policy of any kind', () => {
    const policies = [...schema.matchAll(/create policy (\w+) on public\.expense_shares for (\w+)/g)];
    expect(policies.map(m => m[2])).toEqual(['select']);
  });

  it('only the slug lookup and the keepalive ping are anon-callable', () => {
    // The trip link is the capability. Any other anon-executable function is
    // a new unauthenticated read surface and needs a security review.
    const anonGrants = [...schema.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
      .filter(m => /anon/.test(m[2])).map(m => m[1]).sort();
    expect(anonGrants).toEqual(['get_trip_by_slug', 'is_member', 'keepalive', 'trip_is_active']);
  });

  it('execute is revoked from public before anything is granted', () => {
    const revokeAt = schema.indexOf('revoke execute on all functions in schema public from public;');
    expect(revokeAt).toBeGreaterThan(-1);
    const grants = [...schema.matchAll(/grant execute on function/g)].map(m => m.index ?? 0);
    // The blanket revoke must precede the grants that live in the GRANTS block.
    expect(grants.filter(i => i > revokeAt).length).toBeGreaterThanOrEqual(grants.length - 1);
  });

  it('every RPC is security definer with a pinned search_path', () => {
    const fns = [...schema.matchAll(/create or replace function public\.(\w+)\(/g)];
    expect(fns.length).toBeGreaterThan(5);
    for (const m of fns) {
      const header = schema.slice(m.index ?? 0, schema.indexOf('as $$', m.index ?? 0));
      expect(header, `${m[1]} header`).toMatch(/security definer/);
      expect(header, `${m[1]} header`).toMatch(/set search_path = public/);
    }
  });

  it('add_expense validates that shares sum exactly to the amount', () => {
    const body = schema.slice(schema.indexOf('function public.add_expense('));
    expect(body.slice(0, body.indexOf('$$;'))).toMatch(/v_sum <> p_amount_cents/);
  });

  it('the all-in flag resets on the caller who logged the expense, not the payer', () => {
    const addExpense = schema.slice(schema.indexOf('function public.add_expense('));
    const body = addExpense.slice(0, addExpense.indexOf('$$;'));
    expect(body).toMatch(/update participants set all_expenses_in = false where id = v_me/);
    expect(body).not.toMatch(/all_expenses_in = false where id = p_payer_participant_id/);

    const updateExpense = schema.slice(schema.indexOf('function public.update_expense('));
    // Edits are corrections — they reset no one.
    expect(updateExpense.slice(0, updateExpense.indexOf('$$;'))).not.toMatch(/all_expenses_in/);
  });

  it('realtime publishes the five tables the client subscribes to', () => {
    const published = schema.slice(schema.indexOf('alter publication supabase_realtime add table'));
    const subscribed = read('src/data/useTripData.ts')
      .match(/\['expenses'[^\]]*\]/)?.[0] ?? '';
    for (const t of ['expenses', 'participants', 'settlements', 'comments', 'trips']) {
      expect(published, `${t} not published`).toContain(`public.${t}`);
      expect(subscribed, `${t} not subscribed`).toContain(`'${t}'`);
    }
  });

  it('every table with a client-facing delete path uses replica identity full', () => {
    // Without FULL, a DELETE's realtime payload carries only the primary key,
    // so the client's `trip_id=eq.<id>` filter never matches and other
    // devices never refetch.
    const clientDeletes = [...read('src/data/api.ts').matchAll(/from\('(\w+)'\)\.delete\(\)/g)].map(m => m[1]);
    expect(clientDeletes).toContain('expenses');
    for (const table of new Set(clientDeletes)) {
      expect(schema).toContain(`alter table public.${table} replica identity full;`);
    }
  });
});

describe('invariant: the Supabase project is configured in exactly three places', () => {
  it('URL and publishable key agree across config, rls-check, and keepalive', () => {
    const sources = ['src/lib/config.ts', 'scripts/rls-check.mjs', '.github/workflows/keepalive.yml'];
    const urls = new Set<string>();
    const keys = new Set<string>();
    for (const f of sources) {
      const text = read(f);
      const url = text.match(/https:\/\/\w+\.supabase\.co/)?.[0];
      const key = text.match(/sb_publishable_[\w-]+/)?.[0];
      expect(url, `no Supabase URL in ${f}`).toBeTruthy();
      expect(key, `no publishable key in ${f}`).toBeTruthy();
      urls.add(url!); keys.add(key!);
    }
    expect([...urls]).toHaveLength(1);
    expect([...keys]).toHaveLength(1);
  });

  it('no service-role or secret key ever ships in the repo', () => {
    // The publishable key is public by design; a service-role key would
    // bypass RLS entirely.
    const all = [...srcFiles, 'scripts/rls-check.mjs', '.github/workflows/keepalive.yml'];
    expect(hits(all, /service_role|sb_secret_|SUPABASE_SERVICE/)).toEqual([]);
  });
});

// --------------------------------------------------------- design system

describe('invariant: the Trailhead design system', () => {
  // Known, reviewed exceptions. Anything else raw fails the check.
  const ALLOWED_HEX = /^#(fff|ffffff)$/i;
  const HEX_EXCEPTIONS: Record<string, string[]> = {
    // Deterministic avatar bg/fg pairs — a palette, not theme color.
    'src/ui/components.tsx': [
      '#c7ddd2', '#1f6f54', '#e6d9c5', '#8a6a3b', '#d9cfe8', '#5b4a78', '#f0d9d0',
      '#9a5a3a', '#d0e0ec', '#3a5a78', '#e8e3c8', '#6f6a2f', '#dcd2e0', '#6a4a6f',
      '#cfe3da', '#2f6a55',
    ],
    // Muted label on the dark hero card; predates the token set.
    'src/screens/Home.tsx': ['#a8d4c2'],
  };

  it('colors come from tokens.css, not literals', () => {
    const offenders: string[] = [];
    for (const file of appFiles) {
      for (const l of codeLines(file)) {
        for (const m of l.text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          const hex = m[0];
          if (ALLOWED_HEX.test(hex)) continue;
          if (HEX_EXCEPTIONS[file]?.includes(hex.toLowerCase())) continue;
          offenders.push(`${file}:${l.n}: ${hex}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('owing is amber, never red', () => {
    expect(read('src/ui/tokens.css')).toMatch(/--negative:\s*#b4653a/);
    expect(hits(appFiles, /['"](red|crimson|#f00|#ff0000)['"]/i)).toEqual([]);
  });

  it('.app-scroll stays unpositioned so overlays resolve to #root', () => {
    // TabBar, the FAB and the toast are position:absolute; if .app-scroll
    // ever gains a position they anchor to the scroller and drift.
    const rule = read('src/ui/tokens.css').match(/\.app-scroll\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toBeTruthy();
    expect(rule).not.toMatch(/position\s*:/);
  });

  it('the app frame is fixed-width on desktop', () => {
    expect(read('src/ui/tokens.css')).toMatch(/max-width:\s*430px/);
  });
});

// ------------------------------------------------------------ test wiring

describe('invariant: the eval harness itself stays wired up', () => {
  it('vitest config keeps Playwright specs out of the unit run', () => {
    const config = read('vite.config.ts');
    expect(config).toContain("from 'vitest/config'");   // not 'vite' — test config needs this
    expect(config).toMatch(/exclude: \[[^\]]*'e2e\/\*\*'/);
  });

  it('CI runs the offline eval gate before it builds and deploys', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/npm run eval\b/);
    expect(deploy.indexOf('npm run eval')).toBeLessThan(deploy.indexOf('npm run build'));
  });

  it('every documented eval command exists in package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of ['eval', 'eval:live', 'eval:e2e', 'test', 'build']) {
      expect(pkg.scripts[script], `missing npm script "${script}"`).toBeTruthy();
    }
    expect(pkg.scripts.eval).toContain('vitest run');
    expect(pkg.scripts.eval).toContain('tsc -b');
  });

  it('the live-database evals both ship and are documented', () => {
    for (const f of ['scripts/rls-check.mjs', 'scripts/rpc-contract-check.mjs']) {
      expect(read(f).length).toBeGreaterThan(0);
    }
    expect(read('docs/evals.md')).toContain('rpc-contract-check');
  });

  it('this file is covered by a typecheck project', () => {
    const nodeProject = JSON.parse(read('tsconfig.node.json').replace(/\/\*[\s\S]*?\*\//g, '')) as
      { include: string[] };
    expect(nodeProject.include).toContain('evals');
  });
});

// A guard on the guards: if this file stops finding source, everything above
// would pass vacuously.
describe('eval harness sanity', () => {
  it('found the repo and its source files', () => {
    expect(relative(ROOT, join(ROOT, 'src'))).toBe('src');
    expect(appFiles.length).toBeGreaterThan(15);
    expect(screenFiles.length).toBeGreaterThanOrEqual(8);
    expect(schema.length).toBeGreaterThan(5_000);
  });
});
