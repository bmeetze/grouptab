import { useRef, useState } from 'react';
import type { Participant, ScreenProps } from '../lib/types';
import { computeBalances, simplifyDebts } from '../lib/money';
import { fmtCents, fmtSigned } from '../lib/format';
import { setAllIn, markPaid, closeTrip } from '../data/api';
import { Avatar, participantIndex, Ribbon, TabBar, useToast } from '../ui/components';

// Same convention as TripFeed/ExpenseDetail: screens don't import helpers
// from each other, so this is duplicated rather than shared.
function displayName(p: Participant): string {
  return p.isYou ? 'You' : p.name;
}

export default function Settle({ slug, data, refetch }: ScreenProps) {
  const toast = useToast();
  const { trip, participants, expenses, settlements } = data;
  const closed = trip.status === 'closed';

  // Synchronous re-entrancy locks — same pattern as AddExpense's savingRef:
  // setState doesn't take effect until the next render, so a double-tap
  // would otherwise pass a state-based guard twice in the same closure and
  // fire two RPCs (two setAllIn calls, or — worse — two markPaid inserts
  // recording the same transfer twice).
  const toggleBusyRef = useRef(false);
  const [togglePending, setTogglePending] = useState(false);
  const payBusyRef = useRef(false);
  const [payingKey, setPayingKey] = useState<string | null>(null);
  const closeBusyRef = useRef(false);
  const [closing, setClosing] = useState(false);

  // TripGate only ever renders Settle once data.you is set (it redirects to
  // Join otherwise); this narrows the type for everything below. Hooks
  // above still run unconditionally regardless of this check.
  if (!data.you) return null;
  const you = data.you;

  const ids = participants.map(p => p.id);
  const balances = computeBalances(
    ids,
    expenses.map(e => ({ payerId: e.payerParticipantId, amountCents: e.amountCents, shares: e.shares })),
    settlements.map(s => ({ fromId: s.fromParticipantId, toId: s.toParticipantId, amountCents: s.amountCents })),
  );
  const transfers = simplifyDebts(balances); // computed on the fly — never stored
  const everyoneIn = participants.every(p => p.allExpensesIn);
  const allSquared = Object.values(balances).every(v => v === 0) && expenses.length > 0;
  const waiting = participants.filter(p => !p.allExpensesIn).map(p => p.name);
  const inCount = participants.length - waiting.length;
  const totalSpend = expenses.reduce((s, e) => s + e.amountCents, 0);
  const maxAbs = Math.max(1, ...Object.values(balances).map(v => Math.abs(v)));

  // Both gated on !closed: a closed trip renders neither the toggle card nor
  // the ribbon, so no write control (toggle, undo) ever appears once closed.
  const showAllInCard = !everyoneIn && !allSquared && !closed;
  const showFinalRibbon = everyoneIn && !allSquared && !closed;

  async function handleToggle() {
    if (closed || toggleBusyRef.current) return;
    toggleBusyRef.current = true;
    setTogglePending(true);
    try {
      await setAllIn(you.id, !you.allExpensesIn);
      await refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update');
    } finally {
      toggleBusyRef.current = false;
      setTogglePending(false);
    }
  }

  async function handleMarkPaid(fromId: string, toId: string, amountCents: number) {
    if (closed || payBusyRef.current) return;
    payBusyRef.current = true;
    setPayingKey(`${fromId}:${toId}`);
    try {
      await markPaid(trip.id, fromId, toId, amountCents);
      toast('Marked paid');
      // Await the refetch before releasing the lock (finally below) — the
      // lock is what keeps every "Mark paid" button disabled, so releasing
      // it before the fresh transfer list lands would let a second tap fire
      // another markPaid insert against the still-stale (pre-refetch) list.
      // There's no unique constraint on settlements, so that would silently
      // double-record the same transfer.
      await refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not mark paid');
    } finally {
      payBusyRef.current = false;
      setPayingKey(null);
    }
  }

  async function handleClose() {
    if (closed || closeBusyRef.current) return;
    closeBusyRef.current = true;
    setClosing(true);
    try {
      await closeTrip(trip.id);
      await refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not close trip');
    } finally {
      closeBusyRef.current = false;
      setClosing(false);
    }
  }

  return (
    <div className="screen">
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Settle up</div>

      {showAllInCard && (
        <div className="card" style={{
          border: '1.5px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>All my expenses are in</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>flip this when you've logged everything</div>
            </div>
            <button
              role="switch"
              aria-checked={you.allExpensesIn}
              aria-label="All my expenses are in"
              disabled={togglePending}
              onClick={() => void handleToggle()}
              style={{
                flex: 'none', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: 'none', border: 'none', padding: 0,
                cursor: togglePending ? 'default' : 'pointer',
              }}
            >
              <span style={{
                width: 44, height: 26, borderRadius: 13, position: 'relative', display: 'inline-block',
                background: you.allExpensesIn ? 'var(--accent)' : 'var(--border-strong)',
                transition: 'background 150ms', opacity: togglePending ? 0.7 : 1,
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: you.allExpensesIn ? 20 : 2,
                  width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 150ms',
                }} />
              </span>
            </button>
          </div>
          <div style={{
            display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap',
            borderTop: '1px solid var(--border)', paddingTop: 11,
          }}>
            {participants.map(p => (
              <span key={p.id} style={{ position: 'relative', flex: 'none', opacity: p.allExpensesIn ? 1 : 0.6 }}>
                <Avatar name={p.name} index={participantIndex(participants, p.id)} size={32}
                  ring={p.allExpensesIn ? 'var(--accent)' : undefined} />
                {p.allExpensesIn && (
                  <span style={{
                    position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: '50%',
                    background: 'var(--accent)', color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid var(--surface)',
                  }}>✓</span>
                )}
              </span>
            ))}
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {inCount} of {participants.length} in · waiting on {waiting.join(', ')}
            </span>
          </div>
        </div>
      )}

      {showFinalRibbon && (
        <div style={{ marginBottom: 14 }}>
          <Ribbon>
            <span style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>Everyone's in ✓ — these numbers are final</span>
              <button onClick={() => void handleToggle()} disabled={togglePending} style={{
                flex: 'none', background: 'none', border: 'none', font: 'inherit', fontSize: 11,
                color: 'var(--ink-soft)', textDecoration: 'underline', cursor: togglePending ? 'default' : 'pointer',
                minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>undo</button>
            </span>
          </Ribbon>
        </div>
      )}

      {!allSquared ? (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {participants.map(p => {
              const bal = balances[p.id] ?? 0;
              const width = bal === 0 ? '0%' : `${Math.max(8, Math.round((Math.abs(bal) / maxAbs) * 92))}%`;
              const color = bal > 0 ? 'var(--accent)' : bal < 0 ? 'var(--negative)' : 'var(--ink-faint)';
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    flex: 'none', width: 60, fontSize: 12.5, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{displayName(p)}</span>
                  <div style={{ flex: 1, display: 'flex', height: 14, alignItems: 'stretch' }}>
                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end', borderRight: '1px solid var(--border)' }}>
                      <div style={{ width: bal < 0 ? width : '0%', background: 'var(--negative-bar)', borderRadius: '7px 0 0 7px' }} />
                    </div>
                    <div style={{ width: '50%' }}>
                      <div style={{ width: bal > 0 ? width : '0%', height: '100%', background: 'var(--accent)', borderRadius: '0 7px 7px 0' }} />
                    </div>
                  </div>
                  <span style={{ flex: 'none', width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color }}>
                    {fmtSigned(bal)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 9 }}>
            Transfers
            <span style={{
              fontWeight: 700, fontSize: 11, borderRadius: 9, padding: '2px 8px',
              color: everyoneIn ? 'var(--accent)' : 'var(--warn-fg)',
              background: everyoneIn ? 'var(--accent-tint)' : 'var(--warn-bg)',
            }}>
              {everyoneIn ? 'FINAL' : 'DRAFT — may change'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, opacity: everyoneIn ? 1 : 0.72 }}>
            {transfers.map(t => {
              const fromP = participants.find(p => p.id === t.fromId);
              const toP = participants.find(p => p.id === t.toId);
              const key = `${t.fromId}:${t.toId}`;
              return (
                <div key={key} style={{
                  background: 'var(--surface)', borderRadius: 18, padding: '13px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  boxShadow: 'var(--shadow-card)', gap: 10,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                      {fromP ? displayName(fromP) : 'Someone'} pays{' '}
                      <b style={{ color: 'var(--ink)' }}>{toP ? displayName(toP) : 'Someone'}</b>
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2 }}>{fmtCents(t.amountCents)}</div>
                  </div>
                  {!closed && (
                    <button
                      disabled={payingKey !== null}
                      onClick={() => void handleMarkPaid(t.fromId, t.toId, t.amountCents)}
                      style={{
                        flex: 'none', minHeight: 44, borderRadius: 14, padding: '9px 15px',
                        fontSize: 12.5, fontWeight: 700, font: 'inherit', border: '1.5px solid var(--accent)',
                        cursor: payingKey !== null ? 'default' : 'pointer',
                        background: everyoneIn ? 'var(--accent)' : 'var(--surface)',
                        color: everyoneIn ? '#fff' : 'var(--accent)',
                        opacity: payingKey === key ? 0.6 : 1,
                      }}
                    >Mark paid</button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="card" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
          gap: 10, padding: '22px 16px',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent)',
            fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>All squared up</div>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            {fmtCents(totalSpend)} across {expenses.length} expenses, settled in {settlements.length} transfers.
          </div>
        </div>
      )}

      {settlements.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 16, marginBottom: 9 }}>Payment history</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {settlements.map(s => {
              const fromP = participants.find(p => p.id === s.fromParticipantId);
              const toP = participants.find(p => p.id === s.toParticipantId);
              return (
                <div key={s.id} style={{
                  background: 'var(--surface)', borderRadius: 16, padding: '12px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.65, gap: 10,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-soft)', minWidth: 0 }}>
                    {fromP ? displayName(fromP) : 'Someone'} paid{' '}
                    <b style={{ color: 'var(--ink)' }}>{toP ? displayName(toP) : 'Someone'}</b> · {fmtCents(s.amountCents)}
                  </span>
                  <span style={{ flex: 'none', fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>paid ✓</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!closed && (
        allSquared ? (
          <button
            disabled={closing}
            onClick={() => void handleClose()}
            style={{
              marginTop: 16, width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 18, textAlign: 'center', padding: 15, fontSize: 14.5, fontWeight: 700,
              font: 'inherit', cursor: closing ? 'default' : 'pointer', minHeight: 44, opacity: closing ? 0.7 : 1,
            }}
          >Close trip 🔒</button>
        ) : (
          <div style={{
            marginTop: 16, border: '1.5px dashed var(--border-strong)', color: 'var(--ink-faint)',
            borderRadius: 16, textAlign: 'center', padding: 12, fontSize: 12.5, fontWeight: 600,
          }}>
            Close trip — available when everyone's at $0
          </div>
        )
      )}

      <TabBar slug={slug} active="settle" />
    </div>
  );
}
