// The share slug is 8 random bytes hex-encoded (schema.sql: trips.share_slug),
// so 16 lowercase hex chars. Lowercase only — the column stores it that way and
// accepting other cases would just 404 confusingly.
const SLUG_RE = /^[0-9a-f]{16}$/;
const PATH_SLUG_RE = /\/t\/([0-9a-f]{16})(?:\/|$)/;

// Pulls the trip slug out of whatever a user pasted: a full invite URL or a
// bare slug. Returns null when it isn't recognisable as either.
//
// Any origin is accepted — people paste from localhost, from a link preview, or
// with tracking params attached, and the slug (not the host) is the capability.
// Existence is deliberately NOT checked here: probing before navigation would
// turn this box into an oracle for guessing slugs.
export function parseInvite(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (SLUG_RE.test(trimmed)) return trimmed;

  // Bare host/path pastes ("bmeetze.github.io/grouptab/t/<slug>") have no
  // scheme, so URL() rejects them; retry once with a scheme prepended.
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const { pathname } = new URL(candidate);
      const m = PATH_SLUG_RE.exec(pathname);
      if (m) return m[1];
    } catch { /* not a URL in this form; fall through to the next candidate */ }
  }
  return null;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

// Web Share API where available, clipboard everywhere else.
//
// Must be called directly from a user gesture: navigator.share requires user
// activation, and an intervening await can consume it.
//
// 'cancelled' means the user dismissed the system share sheet — callers should
// stay silent rather than reporting that as a failure.
export async function shareTrip(url: string, tripName: string): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: tripName, text: `Split costs for ${tripName} on GroupTab`, url });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      // Anything else (no share target, permission policy) falls back to copy.
    }
  }
  return copyLink(url);
}

export async function copyLink(url: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function tripUrl(slug: string): string {
  return `${location.origin}/grouptab/t/${slug}`;
}
