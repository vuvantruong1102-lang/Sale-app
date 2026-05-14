import { createClient } from '@/lib/supabase/server';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const supabase = createClient();

  const [ordersRes, adsRes, productsRes, settingsRes] = await Promise.all([
    supabase.from('orders').select('*').order('date_order', { ascending: false }).limit(10000),
    supabase.from('ads').select('*'),
    supabase.from('products').select('*'),
    supabase.from('settings').select('*').single(),
  ]);

  return (
    <DashboardClient
      initialOrders={ordersRes.data || []}
      initialAds={adsRes.data || []}
      initialProducts={productsRes.data || []}
      revRule={settingsRes.data?.rev_rule || 'shipping'}
    />
  );
}
