import { createClient } from '@/lib/supabase/server';
import OrdersClient from './OrdersClient';

export default async function OrdersPage() {
  const supabase = createClient();
  const [{ data: orders }, { data: products }] = await Promise.all([
    supabase.from('orders').select('*').order('date_order', { ascending: false }).limit(20000),
    supabase.from('products').select('sku,cost'),
  ]);
  return <OrdersClient initialOrders={orders || []} products={products || []} />;
}
