import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ensureSession } from '../data/session';
import { createTrip } from '../data/api';
import { useToast } from '../ui/components';

export default function CreateTrip() {
  const [tripName, setTripName] = useState('');
  const [namesRaw, setNamesRaw] = useState('');
  const [youName, setYouName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const names = useMemo(
    () => [...new Set(namesRaw.split(',').map(n => n.trim()).filter(Boolean))],
    [namesRaw],
  );
  // Derived, not an effect: editing the names field can drop the name that was
  // picked as "you", and reconciling during render avoids both a stale
  // selection and the extra render an effect would cost.
  const you = youName !== null && names.includes(youName) ? youName : null;
  // No default selection. The failure this prevents is a creator who doesn't
  // notice which name got claimed, so the pick has to be deliberate.
  const canCreate = tripName.trim().length > 0 && you !== null && !saving;

  // Synchronous re-entrancy lock: setSaving(true) doesn't take effect until
  // the next render, so two rapid taps on "Create & copy link" would
  // otherwise both pass the canCreate check in the same closure and fire
  // two create_trip RPCs (duplicate trip).
  const savingRef = useRef(false);
  async function onCreate() {
    if (savingRef.current || you === null) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await ensureSession();
      const { shareSlug } = await createTrip(tripName.trim(), names, you);
      const url = `${location.origin}/grouptab/t/${shareSlug}`;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard can fail; link is shareable from the trip header */ }
      toast(copied ? 'Link copied — paste it in the group chat' : 'Trip created — share it with the ↗ button');
      navigate(`/t/${shareSlug}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create trip');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to="/" style={{ color: 'var(--ink)', textDecoration: 'none', fontSize: 20 }}>←</Link>
        <span style={{ fontSize: 16, fontWeight: 700 }}>New trip</span>
      </header>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Name the trip.</h1>
      <input value={tripName} onChange={e => setTripName(e.target.value)}
        placeholder="Tahoe 2026" autoFocus
        style={{ width: '100%', minHeight: 48, borderRadius: 16, border: '1.5px solid var(--accent)',
                 padding: '0 14px', font: 'inherit', fontSize: 15, marginBottom: 24 }} />
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
        Who's coming? Commas are fine.
      </p>
      <input value={namesRaw} onChange={e => setNamesRaw(e.target.value)}
        placeholder="You, Jake, Maya"
        style={{ width: '100%', minHeight: 48, borderRadius: 16, border: '1.5px solid var(--border-strong)',
                 padding: '0 14px', font: 'inherit', fontSize: 15, marginBottom: 12 }} />
      {names.length > 0 && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
            Which one is you?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {names.map(n => {
              const selected = n === you;
              return (
                <button key={n} className="chip" onClick={() => setYouName(n)}
                  aria-pressed={selected}
                  style={selected
                    ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                    : undefined}>
                  {n}{selected && ' · you ✓'}
                </button>
              );
            })}
          </div>
        </>
      )}
      <button className="btn btn-primary" disabled={!canCreate} onClick={() => void onCreate()}>
        Create &amp; copy link
      </button>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 12 }}>
        No accounts. The link is the invite.
      </p>
    </div>
  );
}
