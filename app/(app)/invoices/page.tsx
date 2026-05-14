import { createClient } from '@/lib/supabase/server';
import InvoicesClient from './InvoicesClient';

export default async function InvoicesPage() {
  const supabase = createClient();
  const [orders, misa, invStatus] = await Promise.all([
    supabase.from('orders').select('*').order('date_order', { ascending: false }).limit(20000),
    supabase.from('misa_orders').select('*'),
    supabase.from('invoice_status').select('*'),
  ]);
  return (
    <InvoicesClient
      initialOrders={orders.data || []}
      initialMisa={misa.data || []}
      initialInvStatus={invStatus.data || []}
    />
  );
}
