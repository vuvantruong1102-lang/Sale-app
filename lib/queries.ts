'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetchAll';

// ============================================================
// Các hook fetch dữ liệu phía client, có cache qua React Query.
// Nhờ staleTime ở QueryProvider, chuyển panel qua lại sẽ hiện
// ngay từ cache, không fetch lại trong 5 phút.
//
// MẶC ĐỊNH: chỉ tải đơn trong 90 ngày gần nhất cho nhẹ.
// Dữ liệu cũ hơn VẪN CÒN NGUYÊN trong database, không bị xóa —
// chỉ cần gọi với fullHistory=true là tải đủ tất cả.
// ============================================================

// Số ngày hiển thị mặc định. Đổi số này nếu muốn 60/120 ngày...
export const DEFAULT_WINDOW_DAYS = 60;

// Trả về chuỗi ISO của mốc "N ngày trước" tính từ bây giờ.
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ---------- ORDERS panel ----------
export function useOrdersData(fullHistory = false) {
  const since = fullHistory ? undefined : daysAgoISO(DEFAULT_WINDOW_DAYS);

  return useQuery({
    // queryKey khác nhau giữa "90 ngày" và "tất cả" -> cache riêng, không đè nhau.
    queryKey: ['orders-panel', fullHistory ? 'all' : '90d'],
    queryFn: async () => {
      const supabase = createClient();
      const [orders, productsRes, reconRes] = await Promise.all([
        fetchAll(supabase as any, 'orders', {
          orderBy: 'date_order',
          ascending: false,
          // Chỉ lấy đơn mới hơn mốc 90 ngày (bỏ qua nếu fullHistory).
          sinceColumn: since ? 'date_order' : undefined,
          sinceDate: since,
        }),
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

// ---------- DASHBOARD panel ----------
export function useDashboardData(fullHistory = false) {
  const since = fullHistory ? undefined : daysAgoISO(DEFAULT_WINDOW_DAYS);

  return useQuery({
    queryKey: ['dashboard-panel', fullHistory ? 'all' : '60d'],
    queryFn: async () => {
      const supabase = createClient();
      const [orders, adsRes, productsRes, settingsRes] = await Promise.all([
        fetchAll(supabase as any, 'orders', {
          orderBy: 'date_order',
          ascending: false,
          sinceColumn: since ? 'date_order' : undefined,
          sinceDate: since,
        }),
        supabase.from('ads').select('*'),
        supabase.from('products').select('*'),
        supabase.from('settings').select('*').single(),
      ]);
      return {
        orders: orders || [],
        ads: adsRes.data || [],
        products: productsRes.data || [],
        revRule: settingsRes.data?.rev_rule || 'shipping',
      };
    },
  });
}

// ---------- INVOICES panel ----------
export function useInvoicesData(fullHistory = false) {
  const since = fullHistory ? undefined : daysAgoISO(DEFAULT_WINDOW_DAYS);

  return useQuery({
    queryKey: ['invoices-panel', fullHistory ? 'all' : '90d'],
    queryFn: async () => {
      const supabase = createClient();

      let ordersQuery = supabase
        .from('orders')
        .select('*')
        .order('date_order', { ascending: false })
        .limit(20000);
      if (since) ordersQuery = ordersQuery.gte('date_order', since);

      const [orders, misa, invStatus, extInv] = await Promise.all([
        ordersQuery,
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
