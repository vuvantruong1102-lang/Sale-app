import { createClient } from '@/lib/supabase/server';
import ExternalInvoicesClient from './ExternalInvoicesClient';

// Luôn render mới để thấy dữ liệu cập nhật ngay
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ExternalInvoicesPage() {
  const supabase = createClient();
  const [inv, prods, ords] = await Promise.all([
    supabase.from('external_invoices').select('*').order('created_at', { ascending: false }),
    supabase.from('products').select('sku,name,invoice_name,price').order('sku'),
    supabase.from('orders').select('order_id,sku,product_name,quantity,price_deal').limit(20000),
  ]);

  return (
    <ExternalInvoicesClient
      initialInvoices={inv.data || []}
      products={prods.data || []}
      orders={ords.data || []}
    />
  );
}
