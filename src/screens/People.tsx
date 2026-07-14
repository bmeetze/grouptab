import { useState } from 'react';
import { Link } from 'react-router-dom';
import { releaseClaim } from '../data/api';
import { Avatar, useToast } from '../ui/components';
import type { ScreenProps } from '../lib/types';

export default function People({ slug, data, refetch }: ScreenProps) {
  const [releasing, setReleasing] = useState<string | null>(null);
  const toast = useToast();
  const isCreator = data.you !== null && data.you.id === data.trip.creatorParticipantId;

  async function release(participantId: string) {
    if (releasing) return;
    setReleasing(participantId);
    try {
      await releaseClaim(participantId);
      refetch(); // releasing your own claim → data.you becomes null → TripGate drops us to Join
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not release claim');
    } finally {
      setReleasing(null);
    }
  }

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Link to={`/t/${slug}`} style={{ color: 'var(--ink-soft)', textDecoration: 'none', fontSize: 17, padding: '4px 8px 4px 0' }}>←</Link>
        <span style={{ fontSize: 15, fontWeight: 600 }}>People</span>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.participants.map((p, i) => {
          const isYou = p.id === data.you?.id;
          const showAction = p.claimed && (isYou || isCreator);
          return (
            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={p.name} index={i} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{p.name}{isYou ? ' (you)' : ''}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: p.claimed ? 'var(--accent)' : 'var(--ink-faint)' }}>
                  {p.claimed ? 'claimed ✓' : 'unclaimed'}
                </div>
              </div>
              {showAction && (
                <button disabled={releasing === p.id} onClick={() => void release(p.id)}
                  style={{
                    flex: 'none', fontSize: 12, fontWeight: 700, color: 'var(--negative)',
                    border: '1.5px solid #e8d5c8', borderRadius: 12, padding: '7px 12px',
                    background: 'var(--surface)', font: 'inherit', cursor: releasing === p.id ? 'default' : 'pointer',
                    opacity: releasing === p.id ? 0.6 : 1,
                  }}>
                  {isYou ? 'Release my claim' : 'Release'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 4 }}>
        Anyone can release their own name; the trip creator can release anyone's.
      </p>
    </div>
  );
}
