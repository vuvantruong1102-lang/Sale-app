import { createClient } from '@/lib/supabase/server';
import InvoicesClient from './InvoicesClient';

export default async function InvoicesPage() {
  const supabase = createClient();
  const [{ data: invoices }, { data: orders }, { data: settings }] = await Promise.all([
    supabase.from('invoices').select('*').order('invoice_date', { ascending: false }),
    supabase.from('orders').select('*').limit(20000),
    supabase.from('settings').select('*').single(),
  ]);
  return (
    <InvoicesClient
      initialInvoices={invoices || []}
      orders={orders || []}
      revRule={settings?.rev_rule || 'shipping'}
    />
  );
}
