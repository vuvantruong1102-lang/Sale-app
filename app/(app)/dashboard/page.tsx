import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const supabase = createClient();

  const [orders, adsRes, productsRes, settingsRes] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    supabase.from('ads').select('*'),
    supabase.from('products').select('*'),
    supabase.from('settings').select('*').single(),
  ]);

  return (
    <DashboardClient
      initialOrders={orders || []}
      initialAds={adsRes.data || []}
      initialProducts={productsRes.data || []}
      revRule={settingsRes.data?.rev_rule || 'shipping'}
    />
  );
}
