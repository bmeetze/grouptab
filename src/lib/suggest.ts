export interface DescribedExpense { id: string; description: string }

const MAX_SUGGESTIONS = 4;

// Recent unique descriptions from this trip that match what's being typed.
// `expenses` is expected newest-first (fetchTripData orders created_at desc),
// and a Set preserves that insertion order, so recency comes for free.
//
// Prefix matches rank ahead of substring matches; an exact match of the draft
// is dropped (suggesting what's already typed is a no-op tap). `excludeId`
// keeps an expense being edited from suggesting its own description back.
export function suggestDescriptions(
  expenses: DescribedExpense[],
  draft: string,
  excludeId?: string,
): string[] {
  const q = draft.trim().toLowerCase();
  if (q === '') return [];

  const seen = new Set<string>();
  const prefix: string[] = [];
  const substring: string[] = [];

  for (const e of expenses) {
    if (excludeId !== undefined && e.id === excludeId) continue;
    const desc = e.description.trim();
    if (desc === '') continue;
    const lower = desc.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (lower === q) continue;            // already typed
    if (lower.startsWith(q)) prefix.push(desc);
    else if (lower.includes(q)) substring.push(desc);
  }

  return [...prefix, ...substring].slice(0, MAX_SUGGESTIONS);
}
