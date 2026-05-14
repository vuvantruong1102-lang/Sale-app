import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import ProfitClient from './ProfitClient';

export default async function ProfitPage() {
  const supabase = createClient();
  const [orders, ads, products, settings] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    supabase.from('ads').select('*'),
    supabase.from('products').select('*'),
    supabase.from('settings').select('*').single(),
  ]);
  return (
    <ProfitClient
      orders={orders || []}
      ads={ads.data || []}
      products={products.data || []}
      revRule={settings.data?.rev_rule || 'shipping'}
    />
  );
}
