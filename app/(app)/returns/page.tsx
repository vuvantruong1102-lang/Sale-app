import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import ReturnsClient from './ReturnsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ReturnsPage() {
  const supabase = createClient();
  const [orders, returns, reconciliation] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    fetchAll(supabase as any, 'returns', { orderBy: null }),
    fetchAll(supabase as any, 'reconciliation', { orderBy: null }),
  ]);
  return (
    <ReturnsClient
      initialOrders={orders as any[]}
      initialReturns={returns as any[]}
      reconciliation={reconciliation as any[]}
    />
  );
}
