import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import ProfitClient from './ProfitClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProfitPage() {
  const supabase = createClient();
  const [orders, productsRes, reconRes] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    supabase.from('products').select('sku,cost'),
    fetchAll(supabase as any, 'reconciliation', { orderBy: null }),
  ]);
  return (
    <ProfitClient
      orders={orders || []}
      products={productsRes.data || []}
      reconciliation={reconRes as any}
    />
  );
}
