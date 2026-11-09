export interface Trip { id: string; name: string; shareSlug: string; status: 'active' | 'closed'; creatorParticipantId: string | null; }
export interface Participant { id: string; name: string; claimed: boolean; isYou: boolean; allExpensesIn: boolean; }
export interface Comment { id: string; participantId: string; body: string; createdAt: string; }
// amountMinor and shares are integer minor units of `currency` (cents for USD,
// yen for JPY). Settlements are always USD cents. Convert only via lib/fx.ts.
export interface Expense { id: string; payerParticipantId: string; description: string; currency: string; amountMinor: number; flagged: boolean; flaggedByParticipantId: string | null; createdAt: string; updatedAt: string | null; shares: Record<string, number>; comments: Comment[]; }
export interface Settlement { id: string; fromParticipantId: string; toParticipantId: string; amountCents: number; createdAt: string; }
/** Foreign-currency rates: code -> integer nanos-USD per major unit (plain numbers so the offline cache can JSON them; all < 2^53). */
export type TripRates = Record<string, number>;
export interface TripData { trip: Trip; participants: Participant[]; expenses: Expense[]; settlements: Settlement[]; rates: TripRates; you: Participant | null; }
export interface ScreenProps { slug: string; data: TripData; refetch: () => Promise<void>; stale: boolean; }
