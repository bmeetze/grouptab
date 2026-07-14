import { useOnline } from '../data/useOnline';

export function OfflineBanner({ stale }: { stale: boolean }) {
  const online = useOnline();
  if (online && !stale) return null;
  return (
    <div style={{ background: 'var(--dark)', color: '#fff', borderRadius: 14,
      padding: '10px 14px', fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>
      ⚠ You're offline — showing last synced data
    </div>
  );
}
