import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import OrdersClient from './OrdersClient';

// Tránh Vercel cache trang này - luôn render mới
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OrdersPage() {
  const supabase = createClient();
  const [orders, productsRes, reconRes] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    supabase.from('products').select('sku,cost'),
    fetchAll(supabase as any, 'reconciliation', { orderBy: null }),
  ]);
  // DEBUG: log số lượng orders fetch được từ server
  console.log('[OrdersPage SSR] fetchAll returned:', orders.length, 'orders');
  if (orders.length > 0) {
    console.log('[OrdersPage SSR] first:', orders[0].date_order, orders[0].order_id);
    console.log('[OrdersPage SSR] last:', orders[orders.length - 1].date_order, orders[orders.length - 1].order_id);
  }
  return (
    <OrdersClient
      initialOrders={orders}
      products={productsRes.data || []}
      reconciliation={reconRes as any}
    />
  );
}
