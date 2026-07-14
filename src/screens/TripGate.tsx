import { Route, Routes, useParams } from 'react-router-dom';
import { useTripData } from '../data/useTripData';
import Join from './Join';
import TripFeed from './TripFeed';
import AddExpense from './AddExpense';
import ExpenseDetail from './ExpenseDetail';
import People from './People';
import Settle from './Settle';

export default function TripGate() {
  const { slug = '' } = useParams();
  const { data, loading, error, stale, refetch } = useTripData(slug);

  if (loading) return <div className="screen" style={{ color: 'var(--ink-faint)' }}>Loading…</div>;
  if (error || !data) return <div className="screen">Trip not found. Check the link.</div>;
  if (!data.you) return <Join slug={slug} data={data} refetch={refetch} />;

  const props = { slug, data, refetch, stale };
  return (
    <Routes>
      <Route path="" element={<TripFeed {...props} />} />
      <Route path="add" element={<AddExpense {...props} />} />
      <Route path="e/:expenseId" element={<ExpenseDetail {...props} />} />
      <Route path="people" element={<People {...props} />} />
      <Route path="settle" element={<Settle {...props} />} />
    </Routes>
  );
}
