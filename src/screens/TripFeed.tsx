import { Link } from 'react-router-dom';
import { computeBalances } from '../lib/money';
import { fmtCents } from '../lib/format';
import { Avatar, Ribbon, TabBar, participantIndex, useToast } from '../ui/components';
import { OfflineBanner } from '../ui/OfflineBanner';
import { useOnline } from '../data/useOnline';
import type { ScreenProps } from '../lib/types';

// "just now" under 60s, then minutes/hours/days ("4m ago", "4h ago", "2d ago").
export function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function TripFeed({ slug, data, stale }: ScreenProps) {
  const toast = useToast();
  const online = useOnline();
  const { trip, participants, expenses, settlements, you } = data;
  const closed = trip.status === 'closed';

  const balances = computeBalances(
    participants.map(p => p.id),
    expenses.map(e => ({ payerId: e.payerParticipantId, amountCents: e.amountCents, shares: e.shares })),
    settlements.map(s => ({ fromId: s.fromParticipantId, toId: s.toParticipantId, amountCents: s.amountCents })),
  );
  const bal = you ? (balances[you.id] ?? 0) : 0;
  const totalSpend = expenses.reduce((s, e) => s + e.amountCents, 0);

  const heroColor = bal > 0 ? 'var(--accent)' : bal < 0 ? 'var(--negative)' : 'var(--ink-faint)';
  const owedLabel = bal > 0 ? "you're owed" : bal < 0 ? 'you owe' : "you're even";
  // Closed and stale already blocked writes; extend the same gate to offline
  // so the FAB never invites a tap that can't be saved.
  const showFab = !closed && !stale && online;

  async function onShare() {
    const url = `${location.origin}/grouptab/t/${slug}`;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard can fail; the chip stays tappable to retry */ }
    toast(copied ? 'Link copied — paste it in the group chat' : "Couldn't copy — long-press the address bar to share");
  }

  return (
    <div className="screen">
      <OfflineBanner stale={stale} />
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <Link to="/" style={{
            display: 'inline-flex', alignItems: 'center', minHeight: 44, flex: 'none',
            color: 'var(--ink-soft)', textDecoration: 'none', fontSize: 17, padding: '4px 8px 4px 0',
          }}>←</Link>
          <span style={{
            fontSize: 15, fontWeight: 600, letterSpacing: '.2px', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{trip.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 'none' }}>
          <Link to={`/t/${slug}/people`} className="chip" style={{ textDecoration: 'none', color: 'var(--ink-soft)' }}>👥</Link>
          <button className="chip" onClick={() => void onShare()} style={{ color: 'var(--ink-soft)' }}>share ↗</button>
        </div>
      </header>

      {closed && (
        <div style={{ marginTop: 12 }}>
          <Ribbon>🔒 Trip closed · read-only</Ribbon>
        </div>
      )}

      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.5px', marginTop: 8, color: heroColor }}>
        {fmtCents(Math.abs(bal))}
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}>
        {owedLabel} · {fmtCents(totalSpend)} trip total
      </div>

      {expenses.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13, marginTop: 48 }}>
          No expenses yet — add the first one.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {expenses.map(e => {
            const payer = participants.find(p => p.id === e.payerParticipantId);
            const payerName = payer?.name ?? 'Someone';
            const ways = Object.keys(e.shares).length;
            return (
              <Link key={e.id} to={`/t/${slug}/e/${e.id}`} style={{
                display: 'flex', gap: 12, alignItems: 'center', background: 'var(--surface)',
                borderRadius: 18, padding: '12px 14px', boxShadow: 'var(--shadow-card)',
                textDecoration: 'none', color: 'inherit',
              }}>
                <Avatar name={payerName} index={participantIndex(participants, e.payerParticipantId)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14.5, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {e.description}
                    {e.flagged && (
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, color: 'var(--warn-fg)', background: 'var(--warn-bg)',
                        borderRadius: 9, padding: '2px 7px', marginLeft: 7, verticalAlign: 1,
                      }}>⚑</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: 'var(--ink-soft)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {payerName} · split {ways} ways · {timeAgo(e.createdAt)}
                  </div>
                </div>
                <div style={{ flex: 'none', fontSize: 15, fontWeight: 700 }}>{fmtCents(e.amountCents)}</div>
              </Link>
            );
          })}
        </div>
      )}

      {showFab && (
        <Link to={`/t/${slug}/add`} style={{
          position: 'absolute', right: 20, bottom: 'calc(64px + env(safe-area-inset-bottom))',
          width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          boxShadow: 'var(--shadow-fab)', textDecoration: 'none', zIndex: 20,
        }}>+</Link>
      )}

      <TabBar slug={slug} active="expenses" />
    </div>
  );
}
