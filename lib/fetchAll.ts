// Helper: fetch tất cả rows từ Supabase, vượt qua limit mặc định 1000
// Dùng .range(from, to) để paginate theo batch
import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

/**
 * Fetch tất cả rows từ 1 bảng, paginate qua từng trang 1000.
 *
 * QUAN TRỌNG: Phải có tie-breaker để pagination ổn định.
 * Nếu nhiều rows có cùng giá trị sort (vd nhiều đơn cùng ngày giờ), 
 * Postgres trả về thứ tự không xác định giữa các request → trùng/thiếu rows.
 * Tie-breaker mặc định là 'id' (PK) hoặc 'unique_key'.
 *
 * @param supabase - Supabase client
 * @param table - tên bảng
 * @param options.select - cột cần select (default '*')
 * @param options.orderBy - cột sort chính (default 'date_order')
 * @param options.ascending - chiều sort (default false)
 * @param options.tieBreaker - cột phụ để sort ổn định (default 'unique_key' nếu có)
 * @param options.maxRows - hard cap tổng số rows trả về (an toàn)
 */
export async function fetchAll(
  supabase: SupabaseClient,
  table: string,
  options: {
    select?: string;
    orderBy?: string | null;
    ascending?: boolean;
    tieBreaker?: string;
    maxRows?: number;
  } = {}
): Promise<any[]> {
  const {
    select = '*',
    orderBy = 'date_order',
    ascending = false,
    tieBreaker,
    maxRows = 100000,
  } = options;

  // Tie-breaker mặc định theo bảng (id là PK luôn unique)
  const finalTieBreaker = tieBreaker !== undefined ? tieBreaker : 'id';

  const all: any[] = [];
  let from = 0;

  while (from < maxRows) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    let query = supabase.from(table).select(select);
    if (orderBy) query = query.order(orderBy, { ascending });
    // Thêm tie-breaker để pagination ổn định
    if (finalTieBreaker && finalTieBreaker !== orderBy) {
      query = query.order(finalTieBreaker, { ascending: true });
    }
    query = query.range(from, to);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break; // hết
    from += PAGE_SIZE;
  }

  return all;
}
