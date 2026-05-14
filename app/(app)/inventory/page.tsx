import { createClient } from '@/lib/supabase/server';
import InventoryClient from './InventoryClient';

export default async function InventoryPage() {
  const supabase = createClient();
  const [{ data: products }, { data: orders }] = await Promise.all([
    supabase.from('products').select('*').order('sku'),
    supabase.from('orders').select('sku,quantity,status').limit(50000),
  ]);
  return <InventoryClient initialProducts={products || []} orders={orders || []} />;
}
