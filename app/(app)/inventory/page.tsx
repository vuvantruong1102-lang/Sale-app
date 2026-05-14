import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import InventoryClient from './InventoryClient';

export default async function InventoryPage() {
  const supabase = createClient();
  const [{ data: products }, orders] = await Promise.all([
    supabase.from('products').select('*').order('sku'),
    fetchAll(supabase as any, 'orders', { orderBy: null }),
  ]);
  return <InventoryClient initialProducts={products || []} orders={orders || []} />;
}
