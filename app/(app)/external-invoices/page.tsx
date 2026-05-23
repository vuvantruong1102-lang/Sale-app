import { createClient } from '@/lib/supabase/server';
import ExternalInvoicesClient from './ExternalInvoicesClient';

// Luôn render mới để thấy dữ liệu cập nhật ngay
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ExternalInvoicesPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from('external_invoices')
    .select('*')
    .order('created_at', { ascending: false });

  return <ExternalInvoicesClient initialInvoices={data || []} />;
}
