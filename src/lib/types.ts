export interface Trip { id: string; name: string; shareSlug: string; status: 'active' | 'closed'; creatorParticipantId: string | null; }
export interface Participant { id: string; name: string; claimed: boolean; isYou: boolean; allExpensesIn: boolean; }
export interface Comment { id: string; participantId: string; body: string; createdAt: string; }
export interface Expense { id: string; payerParticipantId: string; description: string; amountCents: number; flagged: boolean; flaggedByParticipantId: string | null; createdAt: string; updatedAt: string | null; shares: Record<string, number>; comments: Comment[]; }
export interface Settlement { id: string; fromParticipantId: string; toParticipantId: string; amountCents: number; createdAt: string; }
export interface TripData { trip: Trip; participants: Participant[]; expenses: Expense[]; settlements: Settlement[]; you: Participant | null; }
