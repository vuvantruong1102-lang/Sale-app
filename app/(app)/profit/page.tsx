import { createClient } from '@/lib/supabase/server';
import ProfitClient from './ProfitClient';

export default async function ProfitPage() {
  const supabase = createClient();
  const [orders, ads, products, settings] = await Promise.all([
    supabase.from('orders').select('*').limit(20000),
    supabase.from('ads').select('*'),
    supabase.from('products').select('*'),
    supabase.from('settings').select('*').single(),
  ]);
  return (
    <ProfitClient
      orders={orders.data || []}
      ads={ads.data || []}
      products={products.data || []}
      revRule={settings.data?.rev_rule || 'shipping'}
    />
  );
}
