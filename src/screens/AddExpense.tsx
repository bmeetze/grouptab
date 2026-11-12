import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScreenProps, TripData, Participant } from '../lib/types';
import { computeEqualSplit } from '../lib/money';
import {
  minorToAmountStr, nanosToRateString, nextAmountStr,
  parseAmountStrToMinor, parseRateToNanos, sanitizeDecimalString,
} from '../lib/amount';
import { exponentOf, SUPPORTED_CURRENCIES } from '../lib/currency';
import { suggestDescriptions } from '../lib/suggest';
import { currencySymbol, fmtMoney } from '../lib/format';
import { addExpense } from '../data/api';
import { fetchUsdRate } from '../data/rates';
import { Avatar, Ribbon, participantIndex, useToast } from '../ui/components';
import { useOnline } from '../data/useOnline';

export interface ExpenseFormValues {
  payerParticipantId: string;
  description: string;
  currency: string;
  amountMinor: number;                 // minor units of `currency`
  shares: Record<string, number>;      // minor units of `currency`
  usdNanos: number | null;             // only for the first expense in a currency
}

type SplitMode = 'equal' | 'custom';

function displayName(p: Participant): string {
  return p.isYou ? 'You' : p.name;
}

export function ExpenseForm({ data, initial, initialId, saveLabel, onSave }: {
  data: TripData; initial?: ExpenseFormValues; initialId?: string; saveLabel: string;
  onSave: (v: ExpenseFormValues) => Promise<void>;
}) {
  const { participants, you } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();

  // TripGate guarantees data.you is set before this ever renders; the `?? ''`
  // is just to satisfy `Participant | null`'s type without an early return
  // ahead of the hooks below (react/rules-of-hooks).
  // Feature 01, decision 10: a new expense defaults to the currency of the
  // trip's most recent expense (expenses arrive newest first); an edit keeps
  // its own.
  const [currency, setCurrency] = useState(initial?.currency ?? data.expenses[0]?.currency ?? 'USD');
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const decimals = exponentOf(currency);
  const [amountStr, setAmountStr] = useState(initial ? minorToAmountStr(initial.amountMinor, decimals) : '');
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
    for (const id of Object.keys(initial.shares)) out[id] = minorToAmountStr(initial.shares[id], decimals);
    return out;
  });
  const [saving, setSaving] = useState(false);

  // Feature 01, decision 6: the first expense in a currency carries the trip's
  // rate for it, pre-filled from the rate source and editable. Once the trip
  // has a rate, this row never shows again (Settle is where it changes).
  const needsRate = currency !== 'USD' && !(currency in data.rates);
  const [rateStr, setRateStr] = useState('');
  const [rateStatus, setRateStatus] = useState<'idle' | 'loading' | 'fetched' | 'failed'>('idle');
  const rateTouched = useRef(false);
  useEffect(() => {
    if (!needsRate) return;
    let cancelled = false;
    rateTouched.current = false;
    setRateStr('');
    setRateStatus('loading');
    void fetchUsdRate(currency).then(nanos => {
      if (cancelled || rateTouched.current) return;   // never overwrite what the user typed
      if (nanos === null) { setRateStatus('failed'); return; }
      setRateStr(nanosToRateString(nanos));
      setRateStatus('fetched');
    });
    return () => { cancelled = true; };
  }, [currency, needsRate]);
  const rateNanos = needsRate ? parseRateToNanos(rateStr) : null;

  const amountMinor = parseAmountStrToMinor(amountStr, decimals);
  const sumCustom = splitIds.reduce((sum, id) => sum + parseAmountStrToMinor(custom[id] ?? '', decimals), 0);
  const splitValid = splitMode === 'equal' ? splitIds.length > 0 : (amountMinor > 0 && sumCustom === amountMinor);
  const rateValid = !needsRate || rateNanos !== null;
  const canSave = amountMinor > 0 && descDraft.trim().length > 0 && splitValid && rateValid && !saving;
  const money = (minor: number) => fmtMoney(minor, currency);

  // What still stands between the user and Save, in the order the form reads.
  // Shown under the disabled button so it never just sits there grey.
  const saveBlocker = amountMinor <= 0 ? 'Enter an amount to start'
    : !descDraft.trim() ? 'Add what it was for'
    : !rateValid ? `Enter the ${currency} rate`
    : null;   // a custom split that doesn't add up has its own validator line

  const amountRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);

  function chooseCurrency(next: string) {
    const d = exponentOf(next);
    setCurrency(next);
    setCurrencyPickerOpen(false);
    amountRef.current?.focus();   // inside the tap, so the keyboard comes back
    // Re-shape what's typed to the new currency's decimals (e.g. drop ".50" for JPY).
    setAmountStr(a => sanitizeDecimalString(a, d));
    setCustom(prev => Object.fromEntries(Object.entries(prev).map(([id, v]) => [id, sanitizeDecimalString(v, d)])));
  }

  const payer = participants.find(p => p.id === payerParticipantId);
  const payerLabel = payer ? displayName(payer) : 'Someone';

  // Recent descriptions from this trip only — no new backend data, and the
  // list is already in hand via `data`.
  const suggestions = useMemo(
    () => suggestDescriptions(data.expenses, descDraft, initialId),
    [data.expenses, descDraft, initialId],
  );

  const perHead = splitIds.length > 0 ? Math.floor(amountMinor / splitIds.length) : 0;
  const peopleWord = splitIds.length === 1 ? 'person' : 'people';
  const perHeadLabel = splitMode === 'custom'
    ? `${splitIds.length} ${peopleWord}`
    : (amountMinor > 0 ? `${money(perHead)} each` : `${splitIds.length} ${peopleWord}`);

  const customStatusLabel = amountMinor <= 0
    ? 'Enter the total first'
    : (sumCustom === amountMinor ? `adds up to ${money(amountMinor)} ✓` : `${money(sumCustom)} of ${money(amountMinor)} assigned`);
  const customStatusColor = amountMinor > 0 && sumCustom === amountMinor ? 'var(--accent)' : 'var(--warn-fg)';

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
        shares = computeEqualSplit(amountMinor, splitIds, payerParticipantId);
      } else {
        shares = {};
        for (const id of splitIds) {
          const c = parseAmountStrToMinor(custom[id] ?? '', decimals);
          if (c > 0) shares[id] = c; // drop zero entries; RPC re-validates the sum
        }
      }
      await onSave({
        payerParticipantId, description: descDraft.trim(), currency, amountMinor, shares,
        usdNanos: needsRate ? rateNanos : null,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Enter saves when the form is valid — from any field — but never when a
  // focused activatable control (picker row, mode chip, avatar toggle) should
  // handle the key itself: hijacking Enter there would fire a save with
  // pre-activation state instead of activating it. From the amount field with
  // the form still incomplete, Enter moves on to the description.
  const latest = useRef({ canSave, handleSave, amountMinor });
  useEffect(() => {
    latest.current = { canSave, handleSave, amountMinor };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a, select, textarea')) return; // native activation wins
      if (latest.current.canSave) { e.preventDefault(); void latest.current.handleSave(); return; }
      if (target === amountRef.current && latest.current.amountMinor > 0) {
        e.preventDefault();
        descRef.current?.focus();
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

      {/* One input method for the whole form: real fields, system keyboard.
          The amount is first, focused on arrival, and reads as a field. */}
      <div>
        <div className="section-label" style={{ marginBottom: 6 }}>Amount</div>
        <div className="field field-amount" onClick={e => { if (e.target === e.currentTarget) amountRef.current?.focus(); }}>
          <span className={`field-symbol${amountStr ? ' filled' : ''}`} aria-hidden="true"
            onClick={() => amountRef.current?.focus()}>{currencySymbol(currency)}</span>
          <input
            ref={amountRef} value={amountStr} aria-label="Amount" autoFocus={!initial}
            onChange={e => setAmountStr(prev => nextAmountStr(prev, e.target.value, decimals))}
            inputMode={decimals === 0 ? 'numeric' : 'decimal'} enterKeyHint="next" autoComplete="off"
            placeholder={decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`}
          />
          <button className="chip" onClick={() => setCurrencyPickerOpen(o => !o)}
            aria-label={`Currency: ${currency}. Change currency`} aria-expanded={currencyPickerOpen}
            style={{ flex: 'none', color: 'var(--accent)', fontWeight: 700 }}>
            {currency} ▾
          </button>
        </div>
        {currencyPickerOpen && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
            {SUPPORTED_CURRENCIES.map(c => (
              <button key={c} className="chip" onClick={() => chooseCurrency(c)} aria-pressed={c === currency}
                style={c === currency
                  ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                  : { color: 'var(--ink-soft)' }}>
                {c}
              </button>
            ))}
          </div>
        )}
        {needsRate && (
          <div style={{
            marginTop: 10, background: 'var(--surface)', borderRadius: 14,
            border: `1.5px solid ${rateNanos !== null ? 'var(--accent)' : 'var(--border-strong)'}`,
            padding: '8px 12px', boxSizing: 'border-box', textAlign: 'left',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, minHeight: 44 }}>
              <span style={{ flex: 1 }}>1 {currency} = $</span>
              <input
                value={rateStr} inputMode="decimal" aria-label={`USD per ${currency}`}
                placeholder={rateStatus === 'loading' ? '…' : '0.00'}
                onChange={e => { rateTouched.current = true; setRateStr(e.target.value.replace(/[^0-9.]/g, '')); }}
                style={{
                  width: 110, minHeight: 44, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '0 10px', font: 'inherit', fontSize: 16, color: 'var(--ink)', boxSizing: 'border-box',
                }}
              />
            </label>
            <div style={{ fontSize: 11, color: rateStatus === 'failed' ? 'var(--warn-fg)' : 'var(--ink-faint)' }}>
              {rateStatus === 'loading' && "Fetching today's rate…"}
              {rateStatus === 'fetched' && "Today's ECB rate. Edit it if you like — the whole trip settles at this rate."}
              {rateStatus === 'failed' && "Couldn't fetch a rate — type it in. The whole trip settles at this rate."}
              {rateStatus === 'idle' && 'The whole trip settles at this rate.'}
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="expense-desc" className="section-label" style={{ display: 'block', marginBottom: 6 }}>What for</label>
        <div className="field">
          <input
            id="expense-desc" ref={descRef} value={descDraft}
            onChange={e => setDescDraft(e.target.value)}
            placeholder="Dinner, gas, groceries…" enterKeyHint="done"
            autoComplete="off" autoCapitalize="sentences" maxLength={120}
          />
        </div>
        {suggestions.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9,
          }}>
            {suggestions.map(s => (
              // Sets the description only — amount, payer, split mode and
              // included set are deliberately untouched.
              <button key={s} className="chip" onClick={() => setDescDraft(s)} style={{
                color: 'var(--ink-soft)', fontWeight: 500, maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
              }}>{s}</button>
            ))}
          </div>
        )}
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
                    <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{currencySymbol(currency)}</span>
                    <input
                      value={custom[p.id] ?? ''} aria-label={`${p.name}'s share`}
                      onChange={e => setCustom(prev => ({ ...prev, [p.id]: sanitizeDecimalString(e.target.value, decimals) }))}
                      placeholder={decimals === 0 ? '0' : '0.00'} inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                      style={{
                        width: 96, minHeight: 44, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '9px 10px', font: 'inherit', fontSize: 16, fontWeight: 600,
                        color: 'var(--ink)', boxSizing: 'border-box',
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

      {/* In the flow, not pinned to the bottom: with the keyboard up it sits
          just above the keys instead of underneath them. */}
      <div>
        <button className="btn btn-primary" disabled={!canSave} onClick={() => void handleSave()}>{saveLabel}</button>
        <div aria-live="polite" style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)', marginTop: 8, minHeight: 16 }}>
          {saveBlocker ?? ''}
        </div>
      </div>
    </div>
  );
}

export default function AddExpense({ slug, data, refetch }: ScreenProps) {
  const navigate = useNavigate();
  const toast = useToast();

  async function handleSave(v: ExpenseFormValues) {
    await addExpense({ tripId: data.trip.id, payerParticipantId: v.payerParticipantId,
      description: v.description, currency: v.currency, amountMinor: v.amountMinor, shares: v.shares,
      usdNanos: v.usdNanos });
    toast(`Added ${fmtMoney(v.amountMinor, v.currency)}`);
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
