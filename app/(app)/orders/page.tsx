import { createClient } from '@/lib/supabase/server';
import OrdersClient from './OrdersClient';

export default async function OrdersPage() {
  const supabase = createClient();
  const [{ data: orders }, { data: products }, { data: reconciliation }] = await Promise.all([
    supabase.from('orders').select('*').order('date_order', { ascending: false }).limit(20000),
    supabase.from('products').select('sku,cost'),
    supabase.from('reconciliation').select('order_id,shopee_payout'),
  ]);
  return (
    <OrdersClient
      initialOrders={orders || []}
      products={products || []}
      reconciliation={reconciliation || []}
    />
  );
}
