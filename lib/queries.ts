'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetchAll';

// ============================================================
// Các hook fetch dữ liệu phía client, có cache qua React Query.
// Nhờ staleTime ở QueryProvider, chuyển panel qua lại sẽ hiện
// ngay từ cache, không fetch lại trong 5 phút.
// ============================================================

// ---------- ORDERS panel ----------
export function useOrdersData() {
  return useQuery({
    queryKey: ['orders-panel'],
    queryFn: async () => {
      const supabase = createClient();
      const [orders, productsRes, reconRes] = await Promise.all([
        fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
        supabase.from('products').select('sku,cost'),
        fetchAll(supabase as any, 'reconciliation', { orderBy: null }),
      ]);
      return {
        orders,
        products: productsRes.data || [],
        reconciliation: reconRes as any[],
      };
    },
  });
}

// ---------- INVOICES panel ----------
export function useInvoicesData() {
  return useQuery({
    queryKey: ['invoices-panel'],
    queryFn: async () => {
      const supabase = createClient();
      const [orders, misa, invStatus, extInv] = await Promise.all([
        supabase.from('orders').select('*').order('date_order', { ascending: false }).limit(20000),
        supabase.from('misa_orders').select('*'),
        supabase.from('invoice_status').select('*'),
        supabase.from('external_invoices').select('order_id'),
      ]);
      return {
        orders: orders.data || [],
        misa: misa.data || [],
        invStatus: invStatus.data || [],
        external: extInv.data || [],
      };
    },
  });
}
