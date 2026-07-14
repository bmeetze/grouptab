import { useState } from 'react';
import { ensureSession } from '../data/session';
import { claimParticipant } from '../data/api';
import { Avatar, useToast } from '../ui/components';
import type { TripData } from '../lib/types';

export default function Join({ slug, data, refetch }:
  { slug: string; data: TripData; refetch: () => void }) {
  const [claiming, setClaiming] = useState(false);
  const toast = useToast();

  async function claim(participantId: string, name: string) {
    if (claiming) return;
    setClaiming(true);
    try {
      await ensureSession();
      const won = await claimParticipant(slug, participantId);
      if (!won) toast(`"${name}" was just claimed on another device — pick again`);
      refetch(); // wins → data.you set → TripGate renders the trip; loses → row flips to claimed
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not claim');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="screen">
      <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>You've been invited to</p>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{data.trip.name}</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-soft)', margin: '12px 0 20px' }}>Which one are you?</p>
      {data.participants.map((p, i) => (
        <button key={p.id} disabled={p.claimed || claiming}
          onClick={() => void claim(p.id, p.name)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 56,
            marginBottom: 10, padding: '0 14px', borderRadius: 16, font: 'inherit',
            background: 'var(--surface)', cursor: p.claimed ? 'default' : 'pointer',
            border: p.claimed ? '1px solid var(--border)' : '2px solid var(--accent)',
            opacity: p.claimed ? 0.55 : 1,
          }}>
          <Avatar name={p.name} index={i} />
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1, textAlign: 'left' }}>{p.name}</span>
          <span style={{ fontSize: 12.5, color: p.claimed ? 'var(--ink-faint)' : 'var(--accent)', fontWeight: 600 }}>
            {p.claimed ? 'claimed ✓' : "that's me →"}
          </span>
        </button>
      ))}
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 16 }}>
        No signup. This device remembers you from now on.
      </p>
    </div>
  );
}
