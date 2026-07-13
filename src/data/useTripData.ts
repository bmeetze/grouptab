import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchTripData } from './api';
import type { TripData } from '../lib/types';

const cacheKey = (slug: string) => `gt:trip:${slug}`;

export function useTripData(slug: string) {
  const [data, setData] = useState<TripData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false); // true when showing cached data

  const refetch = useCallback(async () => {
    try {
      const fresh = await fetchTripData(slug);
      setData(fresh); setError(null); setStale(false);
      try { localStorage.setItem(cacheKey(slug), JSON.stringify(fresh)); } catch { /* cache write is best-effort */ }
    } catch (e) {
      try {
        const cached = localStorage.getItem(cacheKey(slug));
        if (cached) { setData(JSON.parse(cached)); setStale(true); }
        else setError(e instanceof Error ? e.message : 'Failed to load trip');
      } catch {
        setError(e instanceof Error ? e.message : 'Failed to load trip');
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime: any change in this trip → refetch (~1s propagation). Refetching
  // whole-trip keeps every client consistent without cache-merge bugs.
  useEffect(() => {
    if (!data?.trip.id) return;
    const tripId = data.trip.id;
    const ch = supabase.channel(`trip:${tripId}`);
    for (const table of ['expenses', 'participants', 'settlements', 'comments', 'trips']) {
      ch.on('postgres_changes',
        { event: '*', schema: 'public', table, filter: table === 'trips' ? `id=eq.${tripId}` : `trip_id=eq.${tripId}` },
        () => void refetch());
    }
    ch.subscribe();
    const onFocus = () => void refetch();      // refetch-on-focus covers dropped connections
    window.addEventListener('focus', onFocus);
    return () => { void supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); };
  }, [data?.trip.id, refetch]);

  return { data, loading, error, stale, refetch };
}
