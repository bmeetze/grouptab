import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScreenProps, TripData, Participant } from '../lib/types';
import { computeEqualSplit } from '../lib/money';
import { fmtCents } from '../lib/format';
import { addExpense } from '../data/api';
import { Avatar, Ribbon, participantIndex, useToast } from '../ui/components';
import { useOnline } from '../data/useOnline';

export interface ExpenseFormValues {
  payerParticipantId: string;
  description: string;
  amountCents: number;
  shares: Record<string, number>;
}

type SplitMode = 'equal' | 'custom';

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

function displayName(p: Participant): string {
  return p.isYou ? 'You' : p.name;
}

// Strips a typed value down to at most one '.', at most 2 decimal digits,
// and no redundant leading zeros ("00" -> "0", "05" -> "5") — the same shape
// rules the on-screen/physical keypad enforces for the amount.
function sanitizeDecimalString(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  const parts = v.split('.');
  const intPart = parts[0].replace(/^0+(?=\d)/, '');
  return parts.length === 1 ? intPart : `${intPart}.${parts[1].slice(0, 2)}`;
}

// Ported from the prototype's tapKey: one '.' max, ≤2 decimals, replaces a
// lone leading '0' rather than building "05", caps total digits at 7.
function appendDigitOrDot(amountStr: string, k: string): string {
  if (k === '.') return amountStr.includes('.') ? amountStr : `${amountStr || '0'}.`;
  const dec = amountStr.split('.')[1];
  if (dec !== undefined && dec.length >= 2) return amountStr;
  if (amountStr.replace('.', '').length >= 7) return amountStr;
  return amountStr === '0' ? k : amountStr + k;
}

function applyKey(amountStr: string, k: string): string {
  return k === '⌫' ? amountStr.slice(0, -1) : appendDigitOrDot(amountStr, k);
}

// '' -> $0.00; otherwise renders the string as-typed, padding the decimal
// part to 2 digits once a '.' is present ("48.5" -> "$48.50").
function formatAmountDisplay(amountStr: string): string {
  if (!amountStr) return '$0.00';
  if (amountStr.endsWith('.')) return `$${amountStr}`;
  const [intPart, decPart] = amountStr.split('.');
  const dollars = intPart === '' ? '0' : intPart;
  return decPart === undefined ? `$${dollars}` : `$${dollars}.${decPart.padEnd(2, '0')}`;
}

// The only two places a string amount becomes integer cents.
function parseAmountStrToCents(amountStr: string): number {
  const n = parseFloat(amountStr || '0');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToAmountStr(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function ExpenseForm({ data, initial, saveLabel, onSave }: {
  data: TripData; initial?: ExpenseFormValues; saveLabel: string;
  onSave: (v: ExpenseFormValues) => Promise<void>;
}) {
  const { participants, you } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();

  // TripGate guarantees data.you is set before this ever renders; the `?? ''`
  // is just to satisfy `Participant | null`'s type without an early return
  // ahead of the hooks below (react/rules-of-hooks).
  const [amountStr, setAmountStr] = useState(initial ? centsToAmountStr(initial.amountCents) : '');
  const [descDraft, setDescDraft] = useState(initial?.description ?? '');
  const [payerParticipantId, setPayerParticipantId] = useState(initial?.payerParticipantId ?? you?.id ?? '');
  const [payerPickerOpen, setPayerPickerOpen] = useState(false);
  // Edit mode always opens in custom mode with the exact stored share
  // amounts: whether a saved split was originally "equal" is unrecoverable
  // from the share numbers alone (an equal split and a custom split that
  // happens to match are indistinguishable), so custom-with-exact-values is
  // the only prefill that can never silently change what gets saved back.
  const [splitMode, setSplitMode] = useState<SplitMode>(initial ? 'custom' : 'equal');
  // Included set derives from participants (canonical order), not from the
  // shares object's key order.
  const [splitIds, setSplitIds] = useState<string[]>(() =>
    initial
      ? participants.filter(p => p.id in initial.shares).map(p => p.id)
      : participants.map(p => p.id),
  );
  const [custom, setCustom] = useState<Record<string, string>>(() => {
    if (!initial) return {};
    const out: Record<string, string> = {};
    for (const id of Object.keys(initial.shares)) out[id] = centsToAmountStr(initial.shares[id]);
    return out;
  });
  const [saving, setSaving] = useState(false);

  const amountCents = parseAmountStrToCents(amountStr);
  const sumCustom = splitIds.reduce((sum, id) => sum + parseAmountStrToCents(custom[id] ?? ''), 0);
  const splitValid = splitMode === 'equal' ? splitIds.length > 0 : (amountCents > 0 && sumCustom === amountCents);
  const canSave = amountCents > 0 && descDraft.trim().length > 0 && splitValid && !saving;

  const payer = participants.find(p => p.id === payerParticipantId);
  const payerLabel = payer ? displayName(payer) : 'Someone';

  const perHead = splitIds.length > 0 ? Math.floor(amountCents / splitIds.length) : 0;
  const peopleWord = splitIds.length === 1 ? 'person' : 'people';
  const perHeadLabel = splitMode === 'custom'
    ? `${splitIds.length} ${peopleWord}`
    : (amountCents > 0 ? `${fmtCents(perHead)} each` : `${splitIds.length} ${peopleWord}`);

  const customStatusLabel = amountCents <= 0
    ? 'Enter the total first'
    : (sumCustom === amountCents ? `adds up to ${fmtCents(amountCents)} ✓` : `${fmtCents(sumCustom)} of ${fmtCents(amountCents)} assigned`);
  const customStatusColor = amountCents > 0 && sumCustom === amountCents ? 'var(--accent)' : 'var(--warn-fg)';

  function toggleSplitId(id: string) {
    setSplitIds(prev => {
      const has = prev.includes(id);
      if (has && prev.length <= 1) {
        toast('At least one person has to be in');
        return prev;
      }
      if (has) return prev.filter(x => x !== id);
      return participants.map(p => p.id).filter(pid => prev.includes(pid) || pid === id);
    });
  }

  // Synchronous re-entrancy lock: setSaving(true) doesn't take effect until
  // the next render, so two rapid triggers (double-tap Save, Enter
  // auto-repeat) would otherwise both pass the canSave check in the same
  // closure and fire two add_expense RPCs (duplicate expense).
  const savingRef = useRef(false);
  async function handleSave() {
    if (savingRef.current || !canSave) return;
    if (!online) { toast("You're offline — writes are disabled"); return; }
    if (data.trip.status === 'closed') { toast('This trip is closed — read-only'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      let shares: Record<string, number>;
      if (splitMode === 'equal') {
        shares = computeEqualSplit(amountCents, splitIds, payerParticipantId);
      } else {
        shares = {};
        for (const id of splitIds) {
          const c = parseAmountStrToCents(custom[id] ?? '');
          if (c > 0) shares[id] = c; // drop zero entries; RPC re-validates the sum
        }
      }
      await onSave({ payerParticipantId, description: descDraft.trim(), amountCents, shares });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Physical keyboard: digits/'.' feed the same amount-string builder as the
  // on-screen keys; Backspace trims it; Enter saves when valid — including
  // from inside the description/custom text inputs (inputs don't consume
  // Enter), but never when a focused activatable control (picker row, mode
  // chip, avatar toggle) should handle the key itself: hijacking Enter there
  // would fire a save with pre-activation state instead of activating it.
  const latest = useRef({ canSave, handleSave });
  useEffect(() => {
    latest.current = { canSave, handleSave };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (e.key === 'Enter') {
        if (target?.closest('button, a, select, textarea')) return; // native activation wins
        if (latest.current.canSave) { e.preventDefault(); void latest.current.handleSave(); }
        return;
      }
      const isTypingField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (isTypingField) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        setAmountStr(a => a.slice(0, -1));
      } else if (e.key === '.' || (e.key >= '0' && e.key <= '9')) {
        e.preventDefault();
        setAmountStr(a => appendDigitOrDot(a, e.key));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div style={{
      minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 14,
      padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => navigate(`/t/${data.trip.shareSlug}`)} aria-label="Close" style={{
          background: 'none', border: 'none', font: 'inherit', fontSize: 19, color: 'var(--ink-soft)',
          cursor: 'pointer', padding: '2px 8px 2px 0', minHeight: 44, display: 'inline-flex', alignItems: 'center',
        }}>✕</button>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{initial ? 'Edit expense' : 'New expense'}</span>
        <span style={{ width: 20 }} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-1px' }}>{formatAmountDisplay(amountStr)}</div>
        <input
          value={descDraft}
          onChange={e => setDescDraft(e.target.value)}
          placeholder="What for? (required)"
          style={{
            fontSize: 15, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface)',
            border: `1.5px solid ${descDraft.trim() ? 'var(--accent)' : 'var(--border-strong)'}`,
            borderRadius: 14, padding: '11px 18px', marginTop: 10, textAlign: 'center',
            font: 'inherit', width: '80%', boxSizing: 'border-box',
          }}
        />
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <button onClick={() => setPayerPickerOpen(o => !o)} style={{
            background: 'none', border: 'none', font: 'inherit', fontSize: 12.5, color: 'var(--ink-soft)',
            cursor: 'pointer', padding: 0, minHeight: 44, display: 'inline-flex', alignItems: 'center',
          }}>
            Paid by <b style={{ color: 'var(--accent)', marginLeft: 4 }}>{payerLabel} ▾</b>
          </button>
          <button onClick={() => setSplitMode(m => (m === 'equal' ? 'custom' : 'equal'))} style={{
            cursor: 'pointer', background: 'var(--accent-tint)', border: 'none', borderRadius: 12,
            padding: '6px 13px', fontWeight: 700, color: 'var(--accent)', fontSize: 12.5, font: 'inherit',
            minHeight: 44, display: 'inline-flex', alignItems: 'center',
          }}>
            Split {splitMode === 'equal' ? 'equally' : 'custom'} ⇄
          </button>
        </div>

        {payerPickerOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {participants.map(p => {
              const selected = p.id === payerParticipantId;
              return (
                <button key={p.id} onClick={() => { setPayerParticipantId(p.id); setPayerPickerOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 52,
                    padding: '0 14px', borderRadius: 14, font: 'inherit', background: 'var(--bg)',
                    cursor: 'pointer', border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                  }}>
                  <Avatar name={p.name} index={participantIndex(participants, p.id)} />
                  <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1, textAlign: 'left' }}>{displayName(p)}</span>
                  {selected && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>✓</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {participants.map(p => {
                const included = splitIds.includes(p.id);
                return (
                  <button key={p.id} onClick={() => toggleSplitId(p.id)} aria-label={`Toggle ${p.name}`} style={{
                    flex: 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    opacity: included ? 1 : 0.6,
                  }}>
                    <Avatar name={p.name} index={participantIndex(participants, p.id)} size={44}
                      ring={included ? 'var(--accent)' : undefined} />
                  </button>
                );
              })}
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginLeft: 'auto' }}>{perHeadLabel}</span>
            </div>

            {splitMode === 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {participants.filter(p => splitIds.includes(p.id)).map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={p.name} index={participantIndex(participants, p.id)} size={26} />
                    <span style={{ fontSize: 13, flex: 1 }}>{displayName(p)}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>$</span>
                    <input
                      value={custom[p.id] ?? ''}
                      onChange={e => setCustom(prev => ({ ...prev, [p.id]: sanitizeDecimalString(e.target.value) }))}
                      placeholder="0.00" inputMode="decimal"
                      style={{
                        width: 84, minHeight: 44, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '9px 10px', fontSize: 13.5, fontWeight: 600,
                        font: 'inherit', color: 'var(--ink)', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))}
                <div style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'right', color: customStatusColor }}>{customStatusLabel}</div>
              </div>
            )}

            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
              {splitMode === 'custom'
                ? 'Enter what each person owes — it must add up to the total.'
                : 'Tap a face to leave them out of this one.'}
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridAutoRows: 52, gap: 9 }}>
        {KEYPAD_KEYS.map(k => (
          <button key={k} onClick={() => setAmountStr(a => applyKey(a, k))} style={{
            background: 'var(--surface)', border: 'none', borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 500, cursor: 'pointer', userSelect: 'none',
            boxShadow: '0 1px 2px rgba(22,36,29,.04)', font: 'inherit', color: 'var(--ink)',
          }}>{k}</button>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--disabled)' }}>your keyboard works here too</div>

      <button className="btn btn-primary" disabled={!canSave} onClick={() => void handleSave()}>{saveLabel}</button>
    </div>
  );
}

export default function AddExpense({ slug, data, refetch }: ScreenProps) {
  const navigate = useNavigate();
  const toast = useToast();

  async function handleSave(v: ExpenseFormValues) {
    await addExpense({ tripId: data.trip.id, payerParticipantId: v.payerParticipantId,
      description: v.description, amountCents: v.amountCents, shares: v.shares });
    toast(`Added ${fmtCents(v.amountCents)}`);
    refetch();
    navigate(`/t/${slug}`);
  }

  if (data.trip.status === 'closed') {
    return (
      <div style={{
        minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 14,
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => navigate(`/t/${slug}`)} aria-label="Close" style={{
            background: 'none', border: 'none', font: 'inherit', fontSize: 19, color: 'var(--ink-soft)',
            cursor: 'pointer', padding: '2px 8px 2px 0', minHeight: 44, display: 'inline-flex', alignItems: 'center',
          }}>✕</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>New expense</span>
          <span style={{ width: 20 }} />
        </div>
        <Ribbon>🔒 Trip closed · read-only</Ribbon>
      </div>
    );
  }

  return <ExpenseForm data={data} saveLabel="Save expense" onSave={handleSave} />;
}
