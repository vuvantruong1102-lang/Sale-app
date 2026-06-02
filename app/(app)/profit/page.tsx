import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetchAll';
import ProfitClient from './ProfitClient';

export default async function ProfitPage() {
  const supabase = createClient();
  const [orders, adSpend, products] = await Promise.all([
    fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
    supabase.from('ad_spend').select('*').order('date', { ascending: false }),
    supabase.from('products').select('*'),
  ]);
  return (
    <ProfitClient
      orders={orders || []}
      adSpend={adSpend.data || []}
      products={products.data || []}
    />
  );
}
