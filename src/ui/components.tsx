import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Participant } from '../lib/types';

// Deterministic low-chroma pastel bg + darker fg pairs, by participant index
// (handoff README §Design Tokens, avatar colors).
const AVATAR_COLORS: [string, string][] = [
  ['#c7ddd2', '#1f6f54'], ['#e6d9c5', '#8a6a3b'], ['#d9cfe8', '#5b4a78'],
  ['#f0d9d0', '#9a5a3a'], ['#d0e0ec', '#3a5a78'], ['#e8e3c8', '#6f6a2f'],
  ['#dcd2e0', '#6a4a6f'], ['#cfe3da', '#2f6a55'],
];

export function avatarColors(index: number): [string, string] {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export function Avatar({ name, index, size = 36, ring }:
  { name: string; index: number; size?: number; ring?: string }) {
  const [bg, fg] = avatarColors(index);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%', background: bg, color: fg,
      fontSize: size * 0.42, fontWeight: 600, flexShrink: 0,
      boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
    }}>{name.trim().charAt(0).toUpperCase()}</span>
  );
}

export function participantIndex(participants: Participant[], id: string): number {
  return Math.max(0, participants.findIndex(p => p.id === id));
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    window.clearTimeout(timer.current);
    setMsg(m);
    timer.current = window.setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--dark)', color: '#fff', padding: '10px 18px',
          borderRadius: 14, fontSize: 13, fontWeight: 500, zIndex: 100,
          maxWidth: 'calc(100% - 40px)', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>{msg}</div>
      )}
    </ToastCtx.Provider>
  );
}

export function TabBar({ slug, active }: { slug: string; active: 'home' | 'expenses' | 'settle' }) {
  const tab = (to: string, key: string, label: string) => (
    <Link to={to} style={{
      flex: 1, textAlign: 'center', padding: '15px 0', textDecoration: 'none',
      fontSize: 12.5, fontWeight: active === key ? 700 : 500,
      color: active === key ? 'var(--accent)' : 'var(--ink-faint)',
      minHeight: 44,
    }}>{label}</Link>
  );
  return (
    <nav style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      display: 'flex', background: 'var(--surface)',
      borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)', zIndex: 10,
    }}>
      {tab('/', 'home', '⌂ Home')}
      {tab(`/t/${slug}`, 'expenses', 'Expenses')}
      {tab(`/t/${slug}/settle`, 'settle', 'Settle up')}
    </nav>
  );
}

export function Ribbon({ children }: { children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 14,
      padding: '10px 14px', fontSize: 13, fontWeight: 600, textAlign: 'center',
    }}>{children}</div>
  );
}
