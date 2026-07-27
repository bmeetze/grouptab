import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseInvite } from '../lib/share';

export default function JoinTrip() {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  function onOpen() {
    const slug = parseInvite(raw);
    if (slug === null) {
      setError("That doesn't look like a GroupTab invite link.");
      return;
    }
    // Navigate without checking existence first: a probe here would let
    // someone test guessed slugs from this box. TripGate handles a
    // well-formed slug that doesn't resolve with "Trip not found."
    navigate(`/t/${slug}`);
  }

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to="/" style={{ color: 'var(--ink)', textDecoration: 'none', fontSize: 20 }}>←</Link>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Join a trip</span>
      </header>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Paste the invite link.</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Someone shared a GroupTab link with you — paste the whole thing here.
      </p>
      <input
        value={raw}
        onChange={e => { setRaw(e.target.value); setError(null); }}
        onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
        placeholder="https://bmeetze.github.io/grouptab/t/…"
        autoFocus
        // Slugs are lowercase hex; autocapitalise/autocorrect corrupt a paste.
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        style={{
          width: '100%', minHeight: 48, borderRadius: 16,
          border: `1.5px solid ${error ? 'var(--warn-fg)' : 'var(--accent)'}`,
          padding: '0 14px', font: 'inherit', fontSize: 15, marginBottom: 8,
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <p style={{ fontSize: 12.5, color: 'var(--warn-fg)', fontWeight: 600, marginBottom: 8 }}>
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={raw.trim().length === 0}
        style={{ marginTop: 12 }} onClick={onOpen}>
        Open trip
      </button>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 12 }}>
        No accounts. The link is the invite.
      </p>
    </div>
  );
}
