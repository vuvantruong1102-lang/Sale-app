import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import OrdersClient from './OrdersClient';

export default async function OrdersPage() {
  const supabase = createClient();
  const [orders, productsRes, reconRes] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    supabase.from('products').select('sku,cost'),
    fetchAll(supabase as any, 'reconciliation', { orderBy: null }),
  ]);
  return (
    <OrdersClient
      initialOrders={orders}
      products={productsRes.data || []}
      reconciliation={reconRes as any}
    />
  );
}
