import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Participant, ScreenProps } from '../lib/types';
import { fmtCents } from '../lib/format';
import { Avatar, avatarColors, participantIndex, useToast } from '../ui/components';
import { addComment, deleteExpense, setFlag, updateExpense } from '../data/api';
import { ExpenseForm, type ExpenseFormValues } from './AddExpense';
import { useOnline } from '../data/useOnline';

const OFFLINE_MSG = "You're offline — writes are disabled";

// Same shape as TripFeed's timeAgo — kept screen-local per the plan's
// structure (screens don't import helpers from each other).
function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function displayName(p: Participant): string {
  return p.isYou ? 'You' : p.name;
}

export default function ExpenseDetail({ slug, data, refetch }: ScreenProps) {
  const { expenseId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { participants, you } = data;
  const closed = data.trip.status === 'closed';
  const expense = data.expenses.find(e => e.id === expenseId);

  const [editing, setEditing] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Synchronous re-entrancy locks — same pattern as AddExpense's savingRef:
  // setState doesn't take effect until the next render, so two rapid taps
  // (double-tap send/delete) would otherwise both pass a state-based guard
  // in the same closure and fire two RPCs.
  const commentSendingRef = useRef(false);
  const flagBusyRef = useRef(false);
  const deletingRef = useRef(false);

  // Expense deleted elsewhere (or by our own delete+refetch below) — the
  // route param no longer resolves in data.expenses. Bounce to the feed
  // instead of crashing on undefined; `replace` so the dead URL doesn't sit
  // in history (and so this effect can't loop: once we're on the feed route,
  // this component is unmounted).
  useEffect(() => {
    if (!expense) navigate(`/t/${slug}`, { replace: true });
  }, [expense, navigate, slug]);

  if (!expense) return null;

  // Arrow consts (not hoisted `function` declarations) defined right after
  // the narrowing check above, so TS carries the non-null `expense` type
  // into these closures instead of widening it back to `Expense | undefined`.
  const handleEditSave = async (v: ExpenseFormValues) => {
    await updateExpense({
      expenseId: expense.id, payerParticipantId: v.payerParticipantId,
      description: v.description, amountCents: v.amountCents, shares: v.shares,
    });
    toast('Saved');
    setEditing(false);
    refetch();
  };

  const toggleFlag = async () => {
    if (flagBusyRef.current) return;
    if (!online) { toast(OFFLINE_MSG); return; }
    flagBusyRef.current = true;
    setFlagBusy(true);
    try {
      await setFlag(expense.id, expense.flagged ? null : (you?.id ?? ''));
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update flag');
    } finally {
      flagBusyRef.current = false;
      setFlagBusy(false);
    }
  };

  const sendComment = async () => {
    const body = commentDraft.trim();
    if (!body || commentSendingRef.current) return;
    if (!online) { toast(OFFLINE_MSG); return; }
    commentSendingRef.current = true;
    setCommentSending(true);
    try {
      await addComment(data.trip.id, expense.id, you?.id ?? '', body);
      setCommentDraft('');
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add comment');
    } finally {
      commentSendingRef.current = false;
      setCommentSending(false);
    }
  };

  const handleDelete = async () => {
    if (deletingRef.current) return;
    if (!online) { toast(OFFLINE_MSG); return; }
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteExpense(expense.id);
      toast('Deleted');
      // Don't rely solely on the realtime DELETE event to clear this expense
      // from the feed: Postgres only logs the primary key for a DELETE's old
      // row unless the table has REPLICA IDENTITY FULL, so the feed's
      // trip_id-filtered subscription can silently miss it. Refetching here
      // guarantees *our own* view is correct immediately regardless of that;
      // other connected clients still depend on the realtime event (or their
      // next focus/reload) to see it disappear.
      refetch();
      navigate(`/t/${slug}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete');
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <ExpenseForm
        data={data}
        initial={{
          payerParticipantId: expense.payerParticipantId,
          description: expense.description,
          amountCents: expense.amountCents,
          shares: expense.shares,
        }}
        saveLabel="Save changes"
        onSave={handleEditSave}
      />
    );
  }

  const payer = participants.find(p => p.id === expense.payerParticipantId);
  const payerName = payer ? displayName(payer) : 'Someone';
  const flaggedBy = expense.flaggedByParticipantId
    ? participants.find(p => p.id === expense.flaggedByParticipantId)
    : undefined;
  const flaggedByName = flaggedBy ? displayName(flaggedBy) : 'Someone';

  const splitParticipants = participants.filter(p => p.id in expense.shares);
  const splitLabel = splitParticipants.length === participants.length
    ? 'SPLIT · EVERYONE'
    : `SPLIT · ${splitParticipants.length} PEOPLE`;

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to={`/t/${slug}`} aria-label="Back" style={{
          display: 'inline-flex', alignItems: 'center', minHeight: 44,
          color: 'var(--ink-soft)', textDecoration: 'none', fontSize: 17, padding: '2px 8px 2px 0',
        }}>←</Link>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Expense</span>
        {closed ? (
          <span style={{ width: 44 }} />
        ) : (
          <button onClick={() => setEditing(true)} style={{
            background: 'none', border: 'none', font: 'inherit', fontSize: 13, color: 'var(--ink-soft)',
            cursor: 'pointer', minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '2px 0 2px 8px',
          }}>✎ edit</button>
        )}
      </header>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.5px' }}>{fmtCents(expense.amountCents)}</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>
          {expense.description}
          {expense.updatedAt != null && (
            <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 500, marginLeft: 6 }}>edited</span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
          paid by {payerName} · {timeAgo(expense.createdAt)}
        </div>
      </div>

      {expense.flagged ? (
        <div style={{
          marginTop: 12, background: 'var(--warn-bg)', borderRadius: 16, padding: '11px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--warn-fg)', fontWeight: 600 }}>⚑ Flagged by {flaggedByName}</span>
          {!closed && (
            <button disabled={flagBusy} onClick={() => void toggleFlag()} style={{
              flex: 'none', background: 'var(--surface)', border: 'none', borderRadius: 12, padding: '6px 13px',
              fontSize: 12, fontWeight: 700, color: 'var(--warn-fg)', cursor: 'pointer', font: 'inherit',
              minHeight: 44, display: 'inline-flex', alignItems: 'center',
            }}>Resolve</button>
          )}
        </div>
      ) : (
        !closed && (
          <button disabled={flagBusy} onClick={() => void toggleFlag()} style={{
            marginTop: 12, width: '100%', border: '1px solid var(--border)', background: 'var(--surface)',
            borderRadius: 16, padding: '11px 14px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-soft)',
            fontWeight: 600, cursor: 'pointer', font: 'inherit', minHeight: 44,
          }}>⚑ Flag for review</button>
        )
      )}

      <div className="card" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="section-label">{splitLabel}</div>
        {splitParticipants.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={p.name} index={participantIndex(participants, p.id)} size={26} />
            <span style={{ fontSize: 13.5, flex: 1 }}>{displayName(p)}</span>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{fmtCents(expense.shares[p.id])}</span>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>leftover cents go to the payer</div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-label">COMMENTS</div>
        {expense.comments.map(c => {
          const author = participants.find(p => p.id === c.participantId);
          const authorName = author ? displayName(author) : 'Someone';
          const fg = avatarColors(participantIndex(participants, c.participantId))[1];
          return (
            <div key={c.id} style={{ background: 'var(--surface)', borderRadius: 16, padding: '10px 14px', fontSize: 13 }}>
              <b style={{ fontSize: 12, color: fg }}>{authorName}</b> — {c.body}
            </div>
          );
        })}
        {!closed && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={commentDraft}
              onChange={e => setCommentDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void sendComment(); } }}
              placeholder="Add a comment…"
              style={{
                flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '11px 14px', fontSize: 13, font: 'inherit', color: 'var(--ink)',
              }}
            />
            <button
              aria-label="Send comment"
              disabled={commentSending || !commentDraft.trim()}
              onClick={() => void sendComment()}
              style={{
                flex: 'none', width: 44, height: 44, borderRadius: '50%', background: 'var(--accent)',
                color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 17, cursor: 'pointer', opacity: commentDraft.trim() ? 1 : 0.6,
              }}
            >↑</button>
          </div>
        )}
      </div>

      {!closed && (confirmingDelete ? (
        <div style={{
          marginTop: 20, background: 'var(--surface)', border: '1.5px solid var(--negative)',
          borderRadius: 16, padding: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--negative)' }}>Delete this expense?</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={deleting} onClick={() => setConfirmingDelete(false)} style={{
              background: 'none', border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700,
              color: 'var(--ink-soft)', padding: '7px 12px', cursor: 'pointer', minHeight: 44,
              display: 'inline-flex', alignItems: 'center',
            }}>Cancel</button>
            <button disabled={deleting} onClick={() => void handleDelete()} style={{
              background: 'var(--negative)', border: 'none', borderRadius: 11, font: 'inherit',
              fontSize: 12.5, fontWeight: 700, color: '#fff', padding: '7px 12px', cursor: 'pointer',
              minHeight: 44, display: 'inline-flex', alignItems: 'center',
            }}>Delete</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmingDelete(true)} style={{
          marginTop: 12, width: '100%', background: 'none', border: 'none', font: 'inherit',
          textAlign: 'center', fontSize: 13, color: 'var(--negative)', fontWeight: 600,
          cursor: 'pointer', minHeight: 44,
        }}>Delete expense…</button>
      ))}
    </div>
  );
}
