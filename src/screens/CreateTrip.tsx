import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ensureSession } from '../data/session';
import { createTrip } from '../data/api';
import { useToast } from '../ui/components';

export default function CreateTrip() {
  const [tripName, setTripName] = useState('');
  const [namesRaw, setNamesRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const names = useMemo(
    () => [...new Set(namesRaw.split(',').map(n => n.trim()).filter(Boolean))],
    [namesRaw],
  );
  const canCreate = tripName.trim().length > 0 && names.length >= 1 && !saving;

  async function onCreate() {
    setSaving(true);
    try {
      await ensureSession();
      const { shareSlug } = await createTrip(tripName.trim(), names, names[0]); // first chip = you
      const url = `${location.origin}/grouptab/t/${shareSlug}`;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard can fail; link is shareable from the trip header */ }
      toast(copied ? 'Link copied — paste it in the group chat' : 'Trip created — share it with the ↗ button');
      navigate(`/t/${shareSlug}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create trip');
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {names.map((n, i) => (
          <span key={n} className="chip" style={i === 0
            ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : undefined}>
            {n}{i === 0 && ' · you ✓'}
          </span>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!canCreate} onClick={() => void onCreate()}>
        Create &amp; copy link
      </button>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 12 }}>
        No accounts. The link is the invite.
      </p>
    </div>
  );
}
