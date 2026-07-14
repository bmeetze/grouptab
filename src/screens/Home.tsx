import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchMyTrips } from '../data/api';
import { computeBalances } from '../lib/money';
import { fmtCents, fmtSigned } from '../lib/format';
import { Avatar, participantIndex } from '../ui/components';
import type { Trip, TripData } from '../lib/types';

type TripRow = { trip: Trip; data: TripData };

function netFor(data: TripData): number {
  if (!data.you) return 0;
  const balances = computeBalances(
    data.participants.map(p => p.id),
    data.expenses.map(e => ({ payerId: e.payerParticipantId, amountCents: e.amountCents, shares: e.shares })),
    data.settlements.map(s => ({ fromId: s.fromParticipantId, toId: s.toParticipantId, amountCents: s.amountCents })),
  );
  return balances[data.you.id] ?? 0;
}

export default function Home() {
  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchMyTrips().then(rows => { if (!cancelled) setTrips(rows); });
    return () => { cancelled = true; };
  }, []);

  if (trips === null) {
    return (
      <div className="screen">
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.3px' }}>GroupTab</div>
        <p style={{ color: 'var(--ink-faint)', marginTop: 24 }}>Loading…</p>
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="screen" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.3px' }}>GroupTab</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, textAlign: 'center' }}>
            Split trip costs without the app-store detour.
          </h1>
          <button className="btn btn-primary" onClick={() => navigate('/new')}>+ New trip</button>
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', textAlign: 'center' }}>
            Got a link from a friend? Just open it.
          </p>
        </div>
      </div>
    );
  }

  const heroIndex = trips.findIndex(t => t.trip.status === 'active');
  const hero = heroIndex >= 0 ? trips[heroIndex] : null;
  const others = hero ? trips.filter((_, i) => i !== heroIndex) : trips;

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.3px' }}>GroupTab</div>

      {hero && (() => {
        const { trip, data } = hero;
        const net = netFor(data);
        const totalSpend = data.expenses.reduce((s, e) => s + e.amountCents, 0);
        return (
          <div style={{
            background: 'var(--accent)', borderRadius: 24, padding: 20,
            display: 'flex', flexDirection: 'column', gap: 10, color: '#fff',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.2px', color: '#a8d4c2' }}>
              HAPPENING NOW
            </div>
            <Link to={`/t/${trip.shareSlug}`} style={{
              fontSize: 18, fontWeight: 700, color: '#fff', textDecoration: 'none',
              minHeight: 44, display: 'flex', alignItems: 'center',
            }}>
              {trip.name} →
            </Link>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.5px' }}>{fmtSigned(net)}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {data.participants.map(p => (
                <Avatar key={p.id} name={p.name} index={participantIndex(data.participants, p.id)} size={26} />
              ))}
              <span style={{ fontSize: 12.5, color: '#a8d4c2', marginLeft: 4 }}>
                {fmtCents(totalSpend)} spent
              </span>
            </div>
            <Link to={`/t/${trip.shareSlug}/add`} style={{
              background: '#fff', color: 'var(--accent)', borderRadius: 16, textAlign: 'center',
              padding: 14, fontSize: 15, fontWeight: 700, marginTop: 6, textDecoration: 'none',
              minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              + Add expense
            </Link>
          </div>
        );
      })()}

      {others.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.2px', color: 'var(--ink-faint)' }}>
            OTHER TRIPS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {others.map(({ trip, data }) => {
              const closed = trip.status === 'closed';
              const net = netFor(data);
              return (
                <Link key={trip.id} to={`/t/${trip.shareSlug}`} style={{
                  background: 'var(--surface)', borderRadius: 16, padding: '14px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  boxShadow: closed ? undefined : 'var(--shadow-card)', opacity: closed ? 0.55 : 1,
                  textDecoration: 'none', color: 'inherit', minHeight: 44,
                }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>
                    {trip.name}{closed ? ' 🔒' : ''}
                  </span>
                  {closed ? (
                    <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>settled</span>
                  ) : (
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: net > 0 ? 'var(--accent)' : net < 0 ? 'var(--negative)' : 'var(--ink-faint)',
                    }}>
                      {fmtSigned(net)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </>
      )}

      <button onClick={() => navigate('/new')} style={{
        font: 'inherit', border: '1.5px dashed var(--disabled)', color: 'var(--ink-soft)',
        background: 'transparent', borderRadius: 16, textAlign: 'center', padding: 15,
        fontSize: 14.5, fontWeight: 600, cursor: 'pointer', minHeight: 48, width: '100%',
      }}>
        + New trip
      </button>
    </div>
  );
}
