import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addParticipant, releaseClaim } from '../data/api';
import { Avatar, useToast } from '../ui/components';
import type { ScreenProps } from '../lib/types';

export default function People({ slug, data, refetch }: ScreenProps) {
  const [releasing, setReleasing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const isCreator = data.you !== null && data.you.id === data.trip.creatorParticipantId;
  const closed = data.trip.status === 'closed';

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

  // Synchronous re-entrancy lock: two fast taps on the confirm button must
  // not both pass the same-closure check and fire two add_participant RPCs.
  const savingRef = useRef(false);
  async function addPerson() {
    const name = newName.trim();
    if (savingRef.current || !name) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await addParticipant(data.trip.id, name);
      toast(`Added ${name}`);
      setNewName('');
      setAdding(false);
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast(msg.includes('duplicate key') ? "That name's already in the trip" : (msg || 'Could not add person'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Link to={`/t/${slug}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, color: 'var(--ink-soft)', textDecoration: 'none', fontSize: 17, padding: '4px 8px 4px 0' }}>←</Link>
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
                <button disabled={releasing !== null} onClick={() => void release(p.id)}
                  style={{
                    flex: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44,
                    fontSize: 12, fontWeight: 700, color: 'var(--negative)',
                    border: '1.5px solid var(--border-strong)', borderRadius: 12, padding: '7px 12px',
                    background: 'var(--surface)', font: 'inherit', cursor: releasing !== null ? 'default' : 'pointer',
                    opacity: releasing === p.id ? 0.6 : 1,
                  }}>
                  {isYou ? 'Release my claim' : 'Release'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!closed && (
        adding ? (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addPerson(); }}
              placeholder="Their name"
              autoFocus
              style={{
                flex: 1, minHeight: 44, borderRadius: 12, border: '1.5px solid var(--border-strong)',
                padding: '0 12px', font: 'inherit', fontSize: 14.5, boxSizing: 'border-box',
              }}
            />
            <button disabled={saving || !newName.trim()} onClick={() => void addPerson()}
              style={{
                flex: 'none', minWidth: 44, minHeight: 44, borderRadius: 12, border: 'none',
                background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13,
                font: 'inherit', cursor: saving ? 'default' : 'pointer',
                opacity: !newName.trim() ? 0.5 : 1, padding: '0 14px',
              }}>
              Add
            </button>
            <button disabled={saving} onClick={() => { setAdding(false); setNewName(''); }}
              aria-label="Cancel"
              style={{
                flex: 'none', minWidth: 44, minHeight: 44, borderRadius: 12, border: 'none',
                background: 'none', color: 'var(--ink-faint)', fontSize: 18, font: 'inherit',
                cursor: saving ? 'default' : 'pointer',
              }}>
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            font: 'inherit', border: '1.5px dashed var(--disabled)', color: 'var(--ink-soft)',
            background: 'transparent', borderRadius: 16, textAlign: 'center', padding: 15,
            fontSize: 14.5, fontWeight: 600, cursor: 'pointer', minHeight: 48, width: '100%', marginTop: 10,
          }}>
            + Add person
          </button>
        )
      )}

      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 4 }}>
        Anyone can release their own name; the trip creator can release anyone's.
      </p>
    </div>
  );
}
