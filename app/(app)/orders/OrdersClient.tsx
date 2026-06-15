'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Order } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, findCol, shortStatus, tagClass, parseDate, inRange } from '@/lib/utils';
import { useResizableCols, ResizeHandle, ColDef } from '@/lib/useResizableCols';
import { fetchAll } from '@/lib/fetchAll';
import {
  Upload, Download, ChevronLeft, ChevronRight, Search, RotateCcw,
  Filter, X, Check
} from 'lucide-react';

const PAGE_SIZE = 50;

// Cấu hình cột mặc định cho bảng đơn hàng
const DEFAULT_COLS: ColDef[] = [
  { key: 'date',         width: 120, minWidth: 90 },
  { key: 'platform',     width: 80,  minWidth: 60 },
  { key: 'orderId',      width: 140, minWidth: 100 },
  { key: 'status',       width: 105, minWidth: 70 },
  { key: 'product',      width: 280, minWidth: 120 },
  { key: 'sku',          width: 95,  minWidth: 60 },
  { key: 'quantity',     width: 70,  minWidth: 50 },
  { key: 'price',        width: 100, minWidth: 80 },
  { key: 'orderValue',   width: 110, minWidth: 80 },
  { key: 'fee',          width: 95,  minWidth: 80 },
  { key: 'feeTTLK',      width: 100, minWidth: 80 },
  { key: 'revenue',      width: 105, minWidth: 80 },
  { key: 'shopeePayout', width: 120, minWidth: 90 },
  { key: 'diff',         width: 100, minWidth: 80 },
  { key: 'cogs',         width: 100, minWidth: 80 },
  { key: 'profit',       width: 105, minWidth: 80 },
  { key: 'returnStatus', width: 90,  minWidth: 70 },
];

// Type cho mỗi col filter
// - 'list': checkbox danh sách value (text/category)
// - 'number': range min/max
// - 'date': range from/to date
type ColFilter =
  | { type: 'list'; selected: Set<string> }   // empty Set = ALL
  | { type: 'number'; min?: number; max?: number }
  | { type: 'date'; from?: string; to?: string };

type Props = {
  initialOrders: Order[];
  products: { sku: string; cost: number }[];
  reconciliation: { order_id: string; shopee_payout: number; total_fee?: number; has_adjustment?: boolean }[];
};

export default function OrdersClient({ initialOrders, products, reconciliation: initialRecon }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [reconciliation, setReconciliation] = useState(initialRecon);
  const [dateRange, setDateRange] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importingRecon, setImportingRecon] = useState(false);
  const [importingTiktok, setImportingTiktok] = useState(false);
  const [importingTiktokRecon, setImportingTiktokRecon] = useState(false);
  const [alert, setAlert] = useState<{ type: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reconFileRef = useRef<HTMLInputElement>(null);
  const tiktokFileRef = useRef<HTMLInputElement>(null);
  const tiktokReconFileRef = useRef<HTMLInputElement>(null);

  // Resize cols
  const { cols, setWidth, reset } = useResizableCols('orders-col-widths', DEFAULT_COLS);
  const colW = (k: string) => cols.find(c => c.key === k)?.width || 100;

  // Filter mỗi cột
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  // Map SKU -> giá vốn để lookup nhanh
  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach(p => m.set(p.sku, p.cost || 0));
    return m;
  }, [products]);

  // Map order_id -> Shopee thanh toán
  const payoutMap = useMemo(() => {
    const m = new Map<string, number>();
    reconciliation.forEach(r => m.set(r.order_id, r.shopee_payout || 0));
    return m;
  }, [reconciliation]);

  // Map order_id -> Tổng phí (lưu trong bảng reconciliation, độc lập với việc xóa/import lại orders)
  const reconFeeMap = useMemo(() => {
    const m = new Map<string, number>();
    reconciliation.forEach(r => { if (r.total_fee != null) m.set(r.order_id, r.total_fee); });
    return m;
  }, [reconciliation]);

  // Tính giá trị derived của mỗi row 1 lần để dùng cho filter + display
  // shopeePayout & phí chỉ hiển thị ở 1 dòng chính của mỗi đơn để tránh nhân đôi
  const rowsWithCalc = useMemo(() => {
    // Bỏ qua dòng mô tả/placeholder của file mẫu (vd "Platform unique order ID.")
    const isPlaceholder = (id: string) =>
      !id || /[\s.]/.test(id) || /order id|unique|sku id|product name/i.test(id);
    const cleanOrders = orders.filter(o => !isPlaceholder(String(o.order_id || '').trim()));

    // Tìm dòng chính của mỗi đơn = dòng có Giá trị ĐH (price_deal × qty) cao nhất
    // → SKU có doanh thu cao hơn sẽ gánh phí
    const mainRowKey = new Map<string, string>(); // order_id -> unique_key dòng chính
    const grouped = new Map<string, Order[]>();
    cleanOrders.forEach(o => {
      const arr = grouped.get(o.order_id) || [];
      arr.push(o);
      grouped.set(o.order_id, arr);
    });
    const orderValueOf = (l: Order) => (l.price_deal || 0) * (l.quantity || 1);
    grouped.forEach((lines, oid) => {
      if (lines.length === 1) {
        mainRowKey.set(oid, lines[0].unique_key);
        return;
      }
      let main = lines[0];
      let maxVal = orderValueOf(main);
      for (const l of lines) {
        const v = orderValueOf(l);
        if (v > maxVal) { main = l; maxVal = v; }
      }
      mainRowKey.set(oid, main.unique_key);
    });

    return cleanOrders.map(o => {
      const price = o.price_deal || 0;
      const quantity = o.quantity || 1;
      const orderValue = price * quantity - (o.shop_voucher || 0);
      const st = shortStatus(o.status || '');

      // Shopee TT chỉ hiển thị ở dòng chính
      const isMainRow = mainRowKey.get(o.order_id) === o.unique_key;
      const hasPayout = payoutMap.has(o.order_id);
      const payoutValue = payoutMap.get(o.order_id) || 0;
      const shopeePayout = isMainRow && hasPayout ? payoutValue : null;

      // ============ PHÍ THEO SÀN (tách riêng) ============
      // Phí gốc lưu trong reconciliation (bền vững) hoặc fee_fix (fallback), chỉ trên DÒNG CHÍNH.
      const orderFee = (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
      const hasReconFee = reconFeeMap.has(o.order_id);
      const rawFee = hasReconFee
        ? (isMainRow ? (reconFeeMap.get(o.order_id) || 0) : 0)
        : (isMainRow ? orderFee : 0);

      const isCancelled = st.text === 'Đã hủy';
      const isCompleted = st.text === 'Hoàn thành' || st.text === 'Đã nhận';

      // Phát hiện đơn THHT (Trả hàng/Hoàn tiền) cho CẢ SHOPEE & TIKTOK:
      // Trạng thái "Hoàn thành"/"Đã hoàn tất" + Sàn TT âm
      const isReturned = isCompleted && hasPayout && payoutValue < 0;

      // ============ PHÍ TIKTOK & PHÍ SHOPEE (2 cột riêng) ============
      // Phí TikTok: CHỈ đơn TikTok (lấy từ Ví TikTok / reconciliation). Đơn Shopee = 0.
      // Phí Shopee: CHỈ đơn Shopee = Giá trị ĐH − Sàn TT (cần có đối soát). Đơn TikTok = 0.
      let feeTikTok = 0;
      let feeShopee = 0;
      if (isReturned) {
        // Đơn THHT: phí = doanh thu (= Sàn TT, số âm thể hiện khoản hoàn)
        if (o.platform === 'tiktok') {
          feeTikTok = isMainRow ? payoutValue : 0;
        } else if (o.platform === 'shopee') {
          feeShopee = isMainRow ? payoutValue : 0;
        }
      } else if (!isCancelled) {
        if (o.platform === 'tiktok') {
          feeTikTok = rawFee;
        } else if (o.platform === 'shopee' && isMainRow && hasPayout) {
          feeShopee = orderValue - payoutValue;
        }
      }
      // Giữ tên cũ để các phần khác (totals, filter, export) tương thích
      // Phí LUÔN hiển thị dương (giá trị tuyệt đối), kể cả đơn THHT
      const totalFee = Math.abs(feeTikTok);
      const feeTTLK = Math.abs(feeShopee);

      // ============ DOANH THU ============
      let revenue: number;
      if (isReturned) {
        revenue = isMainRow ? payoutValue : 0;
      } else if (isCancelled) {
        revenue = isMainRow && hasPayout ? payoutValue : 0;
      } else {
        revenue = orderValue - feeTikTok - feeShopee;
      }

      // ============ GIÁ VỐN ============
      // Đơn THHT hoặc hủy: giá vốn = 0 (không tính)
      const cogs = (isReturned || isCancelled) ? 0 : (costMap.get(o.sku || '') || 0) * quantity;

      // ============ LỢI NHUẬN ============
      // Đơn THHT: lợi nhuận = Shopee TT (âm)
      // Đơn hủy: lợi nhuận = 0
      // Đơn bình thường: lợi nhuận = Shopee TT - Giá vốn HB
      //   (nếu chưa có Shopee TT thì hiển thị —)
      let profit: number | null;
      if (isReturned) {
        profit = isMainRow ? payoutValue : 0;
      } else if (isCancelled) {
        profit = 0;
      } else {
        // Đơn bình thường: cần có giá vốn + Shopee TT mới tính được
        if (cogs > 0 && hasPayout && isMainRow) {
          profit = payoutValue - cogs;
        } else {
          profit = null; // hiển thị —
        }
      }

      const diff = shopeePayout !== null ? shopeePayout - revenue : null;

      // ============ % PHÍ ============
      // = Tổng phí thực tế của đơn ÷ Giá trị đơn hàng (áp dụng cả Shopee & TikTok)
      // TikTok: phí nằm ở totalFee; Shopee: phí nằm ở feeTTLK
      const effectiveFee = (totalFee || 0) + (feeTTLK || 0);
      const feePercent = (isMainRow && orderValue > 0) ? Math.abs((effectiveFee / orderValue) * 100) : null;

      return {
        o, price, quantity, orderValue, totalFee, feeTTLK, revenue, cogs, profit,
        statusText: st.text, statusColor: st.color,
        shopeePayout, diff, feePercent, isMainRow, hasPayout, isCancelled, isReturned,
      };
    });
  }, [orders, costMap, payoutMap]);

  // Tập value duy nhất cho từng cột list-type (dùng cho dropdown checkbox)
  const uniqueValues = useMemo(() => ({
    platform: new Set(orders.map(o => o.platform === 'shopee' ? 'Shopee' : 'TikTok')),
    status: new Set(rowsWithCalc.map(r => r.statusText).sort()),
    sku: new Set(orders.map(o => o.sku || '(trống)').sort()),
  }), [orders, rowsWithCalc]);

  // ============ FILTER LOGIC ============
  const filtered = useMemo(() => {
    let list = rowsWithCalc;

    // Filter theo ngày (toolbar)
    if (dateRange !== 'all') {
      list = list.filter(r => inRange(r.o.date_order, dateRange, dateFrom, dateTo));
    }

    // Filter mỗi cột
    const cf = colFilters;
    list = list.filter(r => {
      const o = r.o;

      // Helper: kiểm tra list filter
      const matchList = (key: string, val: string) => {
        const f = cf[key];
        if (!f || f.type !== 'list' || f.selected.size === 0) return true;
        return f.selected.has(val);
      };
      // Helper: kiểm tra number filter
      const matchNum = (key: string, val: number) => {
        const f = cf[key];
        if (!f || f.type !== 'number') return true;
        if (f.min !== undefined && val < f.min) return false;
        if (f.max !== undefined && val > f.max) return false;
        return true;
      };
      // Helper: kiểm tra date filter (so sánh date-only theo local timezone, không tính giờ)
      const matchDate = (key: string, dateStr: string | null | undefined) => {
        const f = cf[key];
        if (!f || f.type !== 'date') return true;
        if (!dateStr) return false; // không có ngày = không match
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        // Convert sang YYYY-MM-DD theo LOCAL timezone (không phải UTC)
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const ymd = `${y}-${m}-${day}`;
        if (f.from && ymd < f.from) return false;
        if (f.to && ymd > f.to) return false;
        return true;
      };

      if (!matchDate('date', o.date_order)) return false;
      if (!matchList('platform', o.platform === 'shopee' ? 'Shopee' : 'TikTok')) return false;
      if (!matchList('status', r.statusText)) return false;
      if (!matchList('sku', o.sku || '(trống)')) return false;
      if (!matchList('returnStatus', r.isReturned ? 'THHT' : 'Bình thường')) return false;
      if (!matchNum('quantity', r.quantity)) return false;
      if (!matchNum('price', r.price)) return false;
      if (!matchNum('orderValue', r.orderValue)) return false;
      if (!matchNum('fee', r.totalFee)) return false;
      if (!matchNum('feeTTLK', r.feeTTLK)) return false;
      if (!matchNum('revenue', r.shopeePayout ?? 0)) return false;
      if (!matchNum('shopeePayout', r.shopeePayout ?? 0)) return false;
      if (!matchNum('diff', r.feePercent ?? 0)) return false;
      if (!matchNum('cogs', r.cogs)) return false;
      if (!matchNum('profit', r.profit ?? 0)) return false;

      // Filter text cho cột Mã đơn, Sản phẩm (single text search)
      const cf_orderId = cf['orderId'];
      if (cf_orderId && cf_orderId.type === 'list' && cf_orderId.selected.size > 0) {
        const q = norm(Array.from(cf_orderId.selected)[0]);
        if (!norm(o.order_id).includes(q)) return false;
      }
      const cf_prod = cf['product'];
      if (cf_prod && cf_prod.type === 'list' && cf_prod.selected.size > 0) {
        const q = norm(Array.from(cf_prod.selected)[0]);
        if (!norm(o.product_name).includes(q)) return false;
      }

      return true;
    });

    // Search toolbar (full text)
    const q = norm(search);
    if (q) {
      list = list.filter(r =>
        norm(r.o.order_id).includes(q) ||
        norm(r.o.product_name).includes(q) ||
        norm(r.o.sku).includes(q)
      );
    }

    return list;
  }, [rowsWithCalc, dateRange, dateFrom, dateTo, search, colFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFilterCount = Object.values(colFilters).filter(f => {
    if (f.type === 'list') return f.selected.size > 0;
    if (f.type === 'number') return f.min !== undefined || f.max !== undefined;
    if (f.type === 'date') return f.from !== undefined || f.to !== undefined;
    return false;
  }).length;

  const clearAllFilters = () => {
    setColFilters({});
    setPage(1);
  };

  // ============ TÍNH TỔNG CHO CÁC CỘT SỐ (theo filtered rows) ============
  const totals = useMemo(() => {
    let totalQty = 0, totalPrice = 0, totalOrderValue = 0, totalFee = 0, totalFeeTTLK = 0;
    let totalRevenue = 0, totalShopeePayout = 0, totalDiff = 0, totalCogs = 0, totalProfit = 0;
    let countShopeePayout = 0, countProfit = 0;
    filtered.forEach(r => {
      totalQty += r.quantity || 0;
      totalPrice += r.price || 0;
      totalOrderValue += r.orderValue || 0;
      totalFee += r.totalFee || 0;
      totalFeeTTLK += r.feeTTLK || 0;
      totalRevenue += r.revenue || 0;
      totalCogs += r.cogs || 0;
      if (r.shopeePayout !== null) {
        totalShopeePayout += r.shopeePayout;
        countShopeePayout++;
      }
      if (r.diff !== null) totalDiff += r.diff;
      if (r.profit !== null) {
        totalProfit += r.profit;
        countProfit++;
      }
    });
    return {
      totalQty, totalPrice, totalOrderValue, totalFee, totalFeeTTLK,
      totalRevenue, totalShopeePayout, totalDiff, totalCogs, totalProfit,
      countShopeePayout, countProfit,
    };
  }, [filtered]);

  // ============ IMPORT FILE ĐỐI SOÁT SHOPEE ============
  const handleImportRecon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportingRecon(true);
    setAlert(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      // Map order_id -> { payout: tổng cộng, count: số GD, lastDate, hasAdjustment }
      const payouts = new Map<string, { payout: number; count: number; lastDate: Date | null; hasAdjustment: boolean }>();

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        // raw:true → ô ngày là Date object thật, tránh lỗi đảo ngày/tháng + mất giờ
        const allRows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
        const allRowsText: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(30, allRows.length); i++) {
          const row = allRows[i] || [];
          if (row.some(c => norm(c) === norm('Mã đơn hàng'))) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" không tìm thấy cột "Mã đơn hàng"` });
          continue;
        }
        const headers = (allRows[headerRowIdx] || []).map((h: any) => String(h ?? '').trim());
        const c_orderIdx = headers.findIndex(h => norm(h) === norm('Mã đơn hàng'));
        const c_amountIdx = headers.findIndex(h => norm(h) === norm('Số tiền'));
        const c_dateIdx = headers.findIndex(h => norm(h) === norm('Ngày'));
        const c_typeIdx = headers.findIndex(h => norm(h) === norm('Loại giao dịch'));

        if (c_orderIdx === -1 || c_amountIdx === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" thiếu cột Mã đơn hàng hoặc Số tiền` });
          continue;
        }

        // ===== Chặn import nhầm vào nút "Import Ví Shopee" =====
        // File Ví Tiktok có "Tổng số tiền quyết toán"; file đơn hàng có cột sản phẩm "Tên sản phẩm".
        const c_viTiktok = headers.findIndex(h => norm(h).includes('tổng số tiền quyết toán'));
        const c_productName = headers.findIndex(h => norm(h) === norm('Tên sản phẩm'));
        if (c_viTiktok !== -1) {
          setAlert({ type: 'error', text: `File "${f.name}" có vẻ là file Ví Tiktokshop — hãy dùng nút "Import Ví Tiktokshop". Đã bỏ qua.` });
          continue;
        }
        if (c_productName !== -1) {
          setAlert({ type: 'error', text: `File "${f.name}" có vẻ là file đơn hàng — hãy dùng nút "Import Shopee Order". Đã bỏ qua.` });
          continue;
        }

        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
          const row = allRows[i] || [];
          const orderId = String((allRowsText[i] || [])[c_orderIdx] ?? row[c_orderIdx] ?? '').replace(/\s/g, '').trim();
          if (!orderId || orderId === '-') continue;

          const amount = +(row[c_amountIdx] || 0);
          if (isNaN(amount)) continue;

          const dateVal = c_dateIdx >= 0 ? parseDate(row[c_dateIdx]) : null;
          const txType = c_typeIdx >= 0 ? norm(row[c_typeIdx]) : '';
          // Phát hiện giao dịch điều chỉnh: 'Cấn trừ Số dư TK Shopee' hoặc 'Điều chỉnh'
          const isAdjustment = txType.includes('cấn trừ') || txType === norm('Điều chỉnh') || txType.includes('điều chỉnh');

          const cur = payouts.get(orderId) || {
            payout: 0, count: 0, lastDate: null as Date | null, hasAdjustment: false,
          };
          cur.payout += amount;
          cur.count += 1;
          if (isAdjustment) cur.hasAdjustment = true;
          if (dateVal && (!cur.lastDate || dateVal > cur.lastDate)) {
            cur.lastDate = dateVal;
          }
          payouts.set(orderId, cur);
        }
      }

      if (payouts.size === 0) {
        setAlert({ type: 'error', text: 'Không có giao dịch hợp lệ trong file' });
        return;
      }

      const payload = Array.from(payouts.entries()).map(([orderId, data]) => ({
        user_id: user.id,
        order_id: orderId,
        shopee_payout: data.payout,
        transaction_count: data.count,
        last_transaction_date: data.lastDate?.toISOString() || null,
        has_adjustment: data.hasAdjustment,
      }));

      const BATCH = 500;
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase
          .from('reconciliation')
          .upsert(slice, { onConflict: 'user_id,order_id', ignoreDuplicates: false });
        if (error) throw error;
      }

      setAlert({
        type: 'success',
        text: `✓ Đã import đối soát ${payouts.size} đơn hàng từ file Shopee`,
      });

      // Reload reconciliation
      const fresh = await fetchAll(supabase as any, 'reconciliation', { orderBy: null });
      setReconciliation(fresh);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImportingRecon(false);
      if (reconFileRef.current) reconFileRef.current.value = '';
    }
  };

  // ============ IMPORT FILE TIKTOK ORDER ============
  const handleImportTiktok = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportingTiktok(true);
    setAlert(null);

    let added = 0, updated = 0, total = 0;
    const allRows: Order[] = [];

    try {
      // Map trạng thái TikTok sang chuẩn nội bộ (giống định dạng Shopee tiếng Việt)
      const mapStatus = (s: string): string => {
        const n = norm(s);
        if (n.includes('hủy') || n.includes('cancel')) return 'Đã hủy';
        // TikTok dùng "Đã hoàn tất" cho đơn finalized
        if (n.includes('hoàn tất') || n.includes('hoàn thành') || n.includes('completed')) return 'Hoàn thành';
        if (n.includes('đã giao') || n.includes('delivered')) return 'Đã giao';
        if (n.includes('đã vận chuyển') || n.includes('shipped') || n.includes('in transit')) return 'Đang giao';
        if (n.includes('cần vận chuyển') || n.includes('chờ vận chuyển') || n.includes('to ship') || n.includes('awaiting shipment')) return 'Chờ giao';
        if (n.includes('chờ lấy hàng') || n.includes('awaiting collection')) return 'Chờ lấy hàng';
        return s; // giữ nguyên nếu không khớp
      };

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
        // Bản đọc text song song: order_id TikTok dài 18 số nếu đọc raw:true sẽ bị
        // làm tròn (mất 2 số cuối). Lấy order_id từ bản raw:false để giữ chính xác.
        const rowsText: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
        if (rows.length < 3) continue;

        // Row 0 = header, Row 1 = mô tả (skip), Row 2+ = data
        const headers = (rows[0] || []).map((h: any) => String(h ?? '').trim());
        const idx = (key: string) => headers.findIndex(h => norm(h) === norm(key));

        const c_orderId    = idx('Order ID');                       // A
        const c_status     = idx('Order Status');                   // B
        const c_sku        = idx('Seller SKU');                     // G
        const c_skuId      = idx('SKU ID');                         // F
        const c_name       = idx('Product Name');                   // H
        const c_variation  = idx('Variation');                      // I
        const c_qty        = idx('Quantity');                       // J
        const c_subtotal   = idx('SKU Subtotal Before Discount');   // M
        const c_sellerDisc = idx('SKU Seller Discount');            // O
        const c_paidAmount = idx('Order Amount');                   // W (= tổng người mua trả)
        const c_dateOrder  = idx('Created Time');                   // Y
        const c_datePaid   = idx('Paid Time');                      // Z
        const c_dateShip   = idx('Shipped Time');                   // AB
        const c_dateDelivered = idx('Delivered Time');              // AC
        const c_packageId  = idx('Package ID');                     // AY
        const c_tracking   = idx('Tracking ID');                    // AI
        const c_carrier    = idx('Shipping Provider Name');         // AK
        const c_cancelReason = idx('Cancel Reason');                // lý do hủy (TikTok)
        const c_returnedQty  = idx('Sku Quantity of return');       // SL hoàn

        if (c_orderId === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" không có cột "Order ID"` });
          continue;
        }

        // ===== Chặn import nhầm vào nút "Import TiktokShop Order" =====
        // File Ví Tiktok có cột "Tổng số tiền quyết toán"; file đơn Shopee dùng "Mã đơn hàng" (đã loại ở trên).
        if (idx('Tổng số tiền quyết toán') !== -1 || idx('ID đơn hàng/điều chỉnh') !== -1) {
          setAlert({ type: 'error', text: `File "${f.name}" có vẻ là file Ví Tiktokshop — hãy dùng nút "Import Ví Tiktokshop". Đã bỏ qua.` });
          continue;
        }

        const toIso = (v: any): string | null => {
          if (!v) return null;
          // TikTok format: "14/05/2026 16:15:00" hoặc Date object
          if (v instanceof Date) return v.toISOString();
          const s = String(v).trim();
          // Thử parse dd/MM/yyyy HH:mm:ss
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
          if (m) {
            const [, d, mo, y, h, mi, se] = m;
            const dt = new Date(+y, +mo - 1, +d, +h, +mi, +se);
            return dt.toISOString();
          }
          const d = parseDate(v);
          return d ? d.toISOString() : null;
        };

        // Bắt đầu từ row 2 (skip header + description row)
        for (let i = 2; i < rows.length; i++) {
          const r = rows[i] || [];
          // order_id lấy từ bản text (raw:false) để không mất chính xác số dài
          const id = String((rowsText[i] || [])[c_orderId] ?? r[c_orderId] ?? '').replace(/\s/g, '').trim();
          if (!id) continue;
          // Bỏ qua dòng mô tả/placeholder của file mẫu (vd "Platform unique order ID.")
          // Mã đơn thật không chứa dấu cách hay dấu chấm
          if (/[.]/.test(id) || /order id|unique|sku id|product name/i.test(id)) continue;
          const skuVar = String((c_sku >= 0 && r[c_sku]) ?? '').trim() || 'NOSKU';
          const unique_key = id + '__' + skuVar;

          const qty = c_qty >= 0 ? +(r[c_qty] || 1) : 1;
          const subtotal = c_subtotal >= 0 ? +(r[c_subtotal] || 0) : 0;
          const sellerDisc = c_sellerDisc >= 0 ? +(r[c_sellerDisc] || 0) : 0;
          // Giá trị ĐH = cột M - cột O
          const orderValueTT = subtotal - sellerDisc;
          // Giá bán = giá trị ĐH / SL (lưu vào price_deal)
          const pricePerUnit = qty > 0 ? orderValueTT / qty : 0;

          allRows.push({
            unique_key,
            order_id: id,
            platform: 'tiktok' as any,
            package_id: c_packageId >= 0 ? String(r[c_packageId] ?? '') : '',
            tracking_no: c_tracking >= 0 ? String(r[c_tracking] ?? '') : '',
            status: c_status >= 0 ? mapStatus(String(r[c_status] ?? '').trim()) : '',
            carrier: c_carrier >= 0 ? String(r[c_carrier] ?? '') : '',
            sku: skuVar,
            sku_parent: c_skuId >= 0 ? String(r[c_skuId] ?? '') : '',
            product_name: c_name >= 0 ? String(r[c_name] ?? '') : '',
            variation: c_variation >= 0 ? String(r[c_variation] ?? '') : '',
            price_original: 0,
            // Lưu giá bán = giá trị ĐH / SL (vì code tính price * qty - shop_voucher; ta để shop_voucher = 0)
            price_deal: pricePerUnit,
            quantity: qty,
            total_paid: c_paidAmount >= 0 ? +(r[c_paidAmount] || 0) : 0,
            total_order_value: orderValueTT,
            shop_voucher: 0,    // đã trừ trong pricePerUnit rồi
            fee_fix: 0,         // map từ file tài chính sau
            fee_service: 0,
            fee_payment: 0,
            date_order: c_dateOrder >= 0 ? toIso(r[c_dateOrder]) : null,
            date_ship: c_dateShip >= 0 ? toIso(r[c_dateShip]) : null,
            date_complete: c_dateDelivered >= 0 ? toIso(r[c_dateDelivered]) : null,
            cancel_reason: c_cancelReason >= 0 ? String(r[c_cancelReason] ?? '').trim() : '',
            returned_qty: c_returnedQty >= 0 ? +(r[c_returnedQty] || 0) : 0,
          });
          total++;
        }
      }

      if (allRows.length === 0) {
        setAlert({ type: 'error', text: 'Không có dữ liệu hợp lệ trong file TikTok' });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      // FIX: Dedupe unique_key (tránh lỗi ON CONFLICT khi có nhiều dòng cùng order+SKU rỗng)
      const seenKeys = new Map<string, number>();
      allRows.forEach(r => {
        const baseKey = r.unique_key;
        const count = seenKeys.get(baseKey) || 0;
        seenKeys.set(baseKey, count + 1);
        if (count > 0) r.unique_key = `${baseKey}_${count + 1}`;
      });

      // Dedupe phí cho đơn nhiều SKU (giống Shopee). TikTok có thể có 1 đơn nhiều SKU = nhiều row.
      const byOrderId = new Map<string, Order[]>();
      allRows.forEach(r => {
        const arr = byOrderId.get(r.order_id) || [];
        arr.push(r);
        byOrderId.set(r.order_id, arr);
      });

      // Đếm số đơn mới vs cập nhật
      const existingKeys = new Set(orders.map(o => o.unique_key));
      allRows.forEach(r => {
        if (existingKeys.has(r.unique_key)) updated++; else added++;
      });

      const BATCH = 500;
      const payload = allRows.map(r => ({ ...r, user_id: user.id }));
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase
          .from('orders')
          .upsert(slice, { onConflict: 'user_id,unique_key', ignoreDuplicates: false });
        if (error) throw error;
      }

      // Tự sync SKU mới vào products
      const skuMap = new Map<string, { sku: string; name: string; variation: string }>();
      allRows.forEach(r => {
        if (!r.sku || r.sku === 'NOSKU') return;
        if (!skuMap.has(r.sku)) {
          skuMap.set(r.sku, { sku: r.sku, name: r.product_name || '', variation: r.variation || '' });
        }
      });
      const { data: existingProds } = await supabase.from('products').select('sku');
      const existingSkus = new Set((existingProds || []).map(p => p.sku));
      const newProducts = Array.from(skuMap.values())
        .filter(p => !existingSkus.has(p.sku))
        .map(p => ({ ...p, user_id: user.id, stock_initial: 0, cost: 0, price: 0, unit: 'cái' }));
      if (newProducts.length) {
        await supabase.from('products').upsert(newProducts, { onConflict: 'user_id,sku', ignoreDuplicates: true });
      }

      setAlert({
        type: 'success',
        text: `✓ Đã import ${total} dòng TikTok — ${added} đơn mới, ${updated} đơn cập nhật${
          newProducts.length ? `, ${newProducts.length} SKU mới đồng bộ vào kho` : ''
        }`
      });

      const fresh = await fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false });
      setOrders(fresh);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImportingTiktok(false);
      if (tiktokFileRef.current) tiktokFileRef.current.value = '';
    }
  };

  // ============ IMPORT VÍ TIKTOK SHOP (đối soát tài chính) ============
  const handleImportTiktokRecon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportingTiktokRecon(true);
    setAlert(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      // Mỗi đơn có thể có nhiều dòng giao dịch (đơn hàng + điều chỉnh)
      // → cộng dồn settlement_amount và total_fee cho cùng order_id
      type Acc = {
        payout: number;       // Tổng số tiền quyết toán (cột F)
        totalFee: number;     // Tổng phí (cột N) - đổi dấu thành dương
        count: number;
        lastDate: Date | null;
      };
      const accMap = new Map<string, Acc>();

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        // Sheet "Chi tiết đơn hàng" thường là sheet đầu, nếu không thì tìm
        let sheetName = wb.SheetNames[0];
        for (const n of wb.SheetNames) {
          if (norm(n).includes('chi tiết đơn hàng')) { sheetName = n; break; }
        }
        const sh = wb.Sheets[sheetName];
        const allRows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
        const allRowsText: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
        if (allRows.length < 2) continue;

        // Row 0 = header (file này không có meta phía trên)
        // Để an toàn vẫn scan tìm dòng có chữ "ID đơn hàng"
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(10, allRows.length); i++) {
          const row = allRows[i] || [];
          if (row.some(c => norm(c).includes('id đơn hàng'))) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" không tìm thấy cột "ID đơn hàng"` });
          continue;
        }
        const headers = (allRows[headerRowIdx] || []).map((h: any) => String(h ?? '').trim());
        const idx = (key: string) => headers.findIndex(h => norm(h) === norm(key));

        const c_orderId  = idx('ID đơn hàng/điều chỉnh');
        const c_txType   = idx('Loại giao dịch');
        const c_dateSet  = idx('Thời gian quyết toán đơn hàng');
        const c_payout   = idx('Tổng số tiền quyết toán');   // F
        const c_totalFee = idx('Tổng phí');                   // N

        if (c_orderId === -1 || c_payout === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" thiếu cột "ID đơn hàng" hoặc "Tổng số tiền quyết toán"` });
          continue;
        }

        // ===== Chặn import nhầm vào nút "Import Ví Tiktokshop" =====
        // File Ví Shopee có cột "Loại giao dịch" + "Số tiền" (không có "Tổng số tiền quyết toán").
        if (idx('Số tiền') !== -1 && idx('Tổng số tiền quyết toán') === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" có vẻ là file Ví Shopee — hãy dùng nút "Import Ví Shopee". Đã bỏ qua.` });
          continue;
        }

        let countRows = 0, countSkipped = 0;
        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
          const row = allRows[i] || [];
          const orderId = String((allRowsText[i] || [])[c_orderId] ?? row[c_orderId] ?? '').replace(/\s/g, '').trim();
          if (!orderId) { countSkipped++; continue; }

          // Parse payout: trong file mới có giá trị âm như "-14507060" hoặc null
          const payoutCell = row[c_payout];
          const payout = payoutCell === null || payoutCell === undefined || payoutCell === ''
            ? 0
            : Number(String(payoutCell).replace(/,/g, ''));
          if (isNaN(payout)) { countSkipped++; continue; }

          const feeCell = c_totalFee >= 0 ? row[c_totalFee] : 0;
          const feeRaw = feeCell === null || feeCell === undefined || feeCell === ''
            ? 0
            : Number(String(feeCell).replace(/,/g, ''));
          // Tổng phí trong file là số ÂM (vd -118.361) → đổi sang dương để lưu
          const fee = isNaN(feeRaw) ? 0 : Math.abs(feeRaw);

          let dateVal: Date | null = null;
          if (c_dateSet >= 0 && row[c_dateSet]) {
            const d = parseDate(row[c_dateSet]);
            if (d) dateVal = d;
          }

          const cur = accMap.get(orderId) || { payout: 0, totalFee: 0, count: 0, lastDate: null as Date | null };
          cur.payout += payout;
          cur.totalFee += fee;
          cur.count += 1;
          if (dateVal && (!cur.lastDate || dateVal > cur.lastDate)) {
            cur.lastDate = dateVal;
          }
          accMap.set(orderId, cur);
          countRows++;
        }
        console.log(`[Ví TikTok] File "${f.name}": header=row${headerRowIdx}, c_orderId=${c_orderId}, c_payout=${c_payout}, c_totalFee=${c_totalFee}`);
        console.log(`[Ví TikTok] Đã xử lý ${countRows} dòng, skip ${countSkipped}, accMap.size=${accMap.size}`);
      }

      if (accMap.size === 0) {
        setAlert({ type: 'error', text: 'Không có giao dịch hợp lệ trong file Ví TikTok' });
        return;
      }

      // 1. Upsert vào bảng reconciliation (cho cột Sàn TT + Tổng phí)
      const reconPayload = Array.from(accMap.entries()).map(([orderId, a]) => ({
        user_id: user.id,
        order_id: orderId,
        shopee_payout: a.payout,
        total_fee: a.totalFee,
        transaction_count: a.count,
        last_transaction_date: a.lastDate?.toISOString() || null,
      }));

      const BATCH = 500;
      for (let i = 0; i < reconPayload.length; i += BATCH) {
        const slice = reconPayload.slice(i, i + BATCH);
        const { error } = await supabase
          .from('reconciliation')
          .upsert(slice, { onConflict: 'user_id,order_id', ignoreDuplicates: false });
        if (error) throw error;
      }

      // 2. Update fee_fix của bảng orders cho các đơn TikTok này (cho cột Tổng phí)
      //    Chỉ update đơn TikTok đang có trong DB; cộng vào dòng chính (Giá trị ĐH cao nhất)
      // FIX: Fetch orders mới nhất từ DB thay vì dùng state cũ (có thể bị cache)
      const freshTiktokOrders = await fetchAll(supabase as any, 'orders', { orderBy: null });
      const tiktokOrdersByOid = new Map<string, Order[]>();
      (freshTiktokOrders as Order[]).filter(o => o.platform === 'tiktok').forEach(o => {
        const arr = tiktokOrdersByOid.get(o.order_id) || [];
        arr.push(o);
        tiktokOrdersByOid.set(o.order_id, arr);
      });
      console.log(`[Ví TikTok] Tổng đơn TikTok trong DB: ${tiktokOrdersByOid.size} đơn (${(freshTiktokOrders as Order[]).filter(o => o.platform === 'tiktok').length} dòng)`);

      // Build list các orders cần update fee
      const orderUpdates: { unique_key: string; fee_fix: number }[] = [];
      let feeAppliedCount = 0;
      accMap.forEach((acc, oid) => {
        const lines = tiktokOrdersByOid.get(oid);
        if (!lines || lines.length === 0) return;
        // Tìm dòng chính = dòng có Giá trị ĐH cao nhất (price_deal × qty)
        let main = lines[0];
        let maxVal = (main.price_deal || 0) * (main.quantity || 1);
        for (const l of lines) {
          const v = (l.price_deal || 0) * (l.quantity || 1);
          if (v > maxVal) { main = l; maxVal = v; }
        }
        orderUpdates.push({ unique_key: main.unique_key, fee_fix: acc.totalFee });
        feeAppliedCount++;
        // Các dòng phụ giữ fee = 0
        lines.forEach(l => {
          if (l.unique_key !== main.unique_key) {
            orderUpdates.push({ unique_key: l.unique_key, fee_fix: 0 });
          }
        });
      });

      // Update từng dòng (Supabase không hỗ trợ bulk update by unique_key trực tiếp ngoài upsert)
      // Dùng upsert với select dòng đầy đủ
      // FIX: Chia .in() thành batch nhỏ để tránh URL quá dài (>8KB)
      let actualUpdated = 0;
      if (orderUpdates.length > 0) {
        const allKeys = orderUpdates.map(u => u.unique_key);
        const feeMap = new Map(orderUpdates.map(u => [u.unique_key, u.fee_fix]));
        const KEY_BATCH = 100; // .in() max 100 keys per request
        const allExisting: any[] = [];
        for (let i = 0; i < allKeys.length; i += KEY_BATCH) {
          const sliceKeys = allKeys.slice(i, i + KEY_BATCH);
          const { data: existing, error: selectError } = await supabase
            .from('orders').select('*').in('unique_key', sliceKeys);
          if (selectError) throw selectError;
          if (existing) allExisting.push(...existing);
        }
        console.log(`[Ví TikTok] Fetched ${allExisting.length}/${allKeys.length} existing orders to update fee`);

        if (allExisting.length > 0) {
          const updated = allExisting.map(o => ({ ...o, fee_fix: feeMap.get(o.unique_key) ?? o.fee_fix }));
          for (let i = 0; i < updated.length; i += BATCH) {
            const slice = updated.slice(i, i + BATCH);
            const { error } = await supabase
              .from('orders')
              .upsert(slice, { onConflict: 'user_id,unique_key', ignoreDuplicates: false });
            if (error) throw error;
            actualUpdated += slice.length;
          }
        }
      }

      setAlert({
        type: 'success',
        text: `✓ Đã import Ví TikTok: ${accMap.size} đơn quyết toán • Khớp được ${feeAppliedCount} đơn TikTok có trong DB • Đã update phí cho ${actualUpdated} dòng`,
      });

      // Reload data
      const [freshOrders, freshRecon] = await Promise.all([
        fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false }),
        fetchAll(supabase as any, 'reconciliation', { orderBy: null }),
      ]);
      setOrders(freshOrders);
      setReconciliation(freshRecon);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImportingTiktokRecon(false);
      if (tiktokReconFileRef.current) tiktokReconFileRef.current.value = '';
    }
  };

  // ============ IMPORT (giữ nguyên + dedupe) ============
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImporting(true);
    setAlert(null);

    let added = 0, updated = 0, total = 0;
    const allRows: Order[] = [];

    try {
      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        // raw:true → giữ nguyên Date object cho ô ngày & số cho ô số.
        // (raw:false sẽ format ô ngày thành chuỗi kiểu Mỹ "M/D/YY" và mất giờ → parseDate đảo ngày/tháng + 00:00)
        const rows: any[] = XLSX.utils.sheet_to_json(sh, { defval: null, raw: true });
        // Bản text song song để lấy order_id chính xác (phòng mã đơn toàn số bị làm tròn)
        const rowsText: any[] = XLSX.utils.sheet_to_json(sh, { defval: null, raw: false });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);

        const c_id = findCol(headers, 'Mã đơn hàng', 'Order ID', 'ID đơn hàng');
        const c_kien = findCol(headers, 'Mã Kiện Hàng', 'Mã kiện');
        const c_track = findCol(headers, 'Mã vận đơn', 'Tracking Number');
        const c_status = findCol(headers, 'Trạng Thái Đơn Hàng', 'Order Status', 'Trạng thái');
        const c_carrier = findCol(headers, 'Đơn Vị Vận Chuyển', 'Shipping Provider');
        const c_sku = findCol(headers, 'SKU phân loại hàng', 'Seller SKU', 'SKU');
        const c_skuParent = findCol(headers, 'SKU sản phẩm', 'Parent SKU');
        const c_name = findCol(headers, 'Tên sản phẩm', 'Product Name');
        const c_var = findCol(headers, 'Tên phân loại hàng', 'Variation');
        const c_priceOrig = findCol(headers, 'Giá gốc', 'Original Price');
        const c_priceDeal = findCol(headers, 'Giá ưu đãi', 'Deal Price');
        const c_qty = findCol(headers, 'Số lượng', 'Quantity');
        const c_paid = findCol(headers, 'Tổng số tiền Người mua thanh toán', 'Total Paid');
        const c_total = findCol(headers, 'Tổng giá trị đơn hàng (VND)', 'Total Order Value');
        const c_voucher = findCol(headers, 'Mã giảm giá của Shop', 'Shop Voucher');
        const c_feeFix = findCol(headers, 'Phí cố định', 'Commission Fee');
        const c_feeSvc = findCol(headers, 'Phí Dịch Vụ', 'Service Fee');
        const c_feePay = findCol(headers, 'Phí thanh toán', 'Phí xử lý giao dịch', 'Payment Fee', 'Transaction Fee');
        const c_dateOrder = findCol(headers, 'Ngày đặt hàng', 'Order Time');
        const c_dateShip = findCol(headers, 'Ngày gửi hàng', 'Ship Time');
        const c_dateComplete = findCol(headers, 'Thời gian hoàn thành đơn hàng', 'Completed Time');
        // Phân hệ Đơn hủy/Trả hàng
        const c_refundStatus = findCol(headers, 'Trạng thái Trả hàng/Hoàn tiền', 'Return/Refund Status');
        const c_cancelReason = findCol(headers, 'Lý do hủy', 'Cancellation Reason');
        const c_returnedQty = findCol(headers, 'Số lượng sản phẩm được hoàn trả', 'Returned Quantity');

        if (!c_id) {
          setAlert({ type: 'error', text: `File "${f.name}" không có cột Mã đơn hàng` });
          continue;
        }

        // ===== Chặn import nhầm vào nút "Import Shopee Order" =====
        // File đơn hàng phải có cột sản phẩm; file Ví (đối soát) chỉ có Mã đơn hàng + Số tiền + Loại giao dịch.
        const looksLikeViFile = findCol(headers, 'Loại giao dịch') !== null
          && findCol(headers, 'Số tiền') !== null
          && !c_name && !c_qty;
        if (looksLikeViFile) {
          setAlert({ type: 'error', text: `File "${f.name}" có vẻ là file Ví Shopee — hãy dùng nút "Import Ví Shopee". Đã bỏ qua.` });
          continue;
        }
        // File đơn TikTok dùng header tiếng Anh "Order ID" + "SKU Subtotal..." → không hợp nút Shopee
        const looksLikeTiktokOrder = findCol(headers, 'SKU Subtotal Before Discount') !== null
          || (findCol(headers, 'Order ID') !== null && findCol(headers, 'Order Amount') !== null);
        if (looksLikeTiktokOrder) {
          setAlert({ type: 'error', text: `File "${f.name}" có vẻ là file đơn TikTokShop — hãy dùng nút "Import TiktokShop Order". Đã bỏ qua.` });
          continue;
        }

        const fn = f.name.toLowerCase();
        const platform = fn.includes('tiktok') || fn.includes('tts') ? 'tiktok' : 'shopee';

        const toIso = (v: any): string | null => {
          const d = parseDate(v);
          return d ? d.toISOString() : null;
        };

        for (let ri = 0; ri < rows.length; ri++) {
          const r = rows[ri];
          const idText = c_id ? (rowsText[ri]?.[c_id] ?? r[c_id!]) : r[c_id!];
          const id = String(idText ?? '').replace(/\s/g, '').trim();
          if (!id) continue;
          // Bỏ qua dòng mô tả/placeholder của file mẫu (vd "Platform unique order ID.")
          if (/[.]/.test(id) || /order id|unique|sku id|product name/i.test(id)) continue;
          const skuVar = String((c_sku && r[c_sku]) ?? '').trim() || 'NOSKU';
          const unique_key = id + '__' + skuVar;
          allRows.push({
            unique_key, order_id: id, platform: platform as any,
            package_id: c_kien ? String(r[c_kien] ?? '') : '',
            tracking_no: c_track ? String(r[c_track] ?? '') : '',
            status: c_status ? String(r[c_status] ?? '').trim() : '',
            carrier: c_carrier ? String(r[c_carrier] ?? '') : '',
            sku: skuVar,
            sku_parent: c_skuParent ? String(r[c_skuParent] ?? '') : '',
            product_name: c_name ? String(r[c_name] ?? '') : '',
            variation: c_var ? String(r[c_var] ?? '') : '',
            price_original: +(r[c_priceOrig!] || 0),
            price_deal: +(r[c_priceDeal!] || 0),
            quantity: +(r[c_qty!] || 1),
            total_paid: +(r[c_paid!] || 0),
            total_order_value: +(r[c_total!] || 0),
            shop_voucher: +(r[c_voucher!] || 0),
            fee_fix: +(r[c_feeFix!] || 0),
            fee_service: +(r[c_feeSvc!] || 0),
            fee_payment: +(r[c_feePay!] || 0),
            date_order: toIso(r[c_dateOrder!]),
            date_ship: toIso(r[c_dateShip!]),
            date_complete: toIso(r[c_dateComplete!]),
            // Phân hệ Đơn hủy/Trả hàng
            refund_status: c_refundStatus ? String(r[c_refundStatus] ?? '').trim() : '',
            cancel_reason: c_cancelReason ? String(r[c_cancelReason] ?? '').trim() : '',
            returned_qty: c_returnedQty ? +(r[c_returnedQty] || 0) : 0,
          });
          total++;
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Không xác thực được người dùng');

      // ============================================================
      // FIX: Đảm bảo unique_key không bị trùng trong allRows.
      // File Shopee đôi khi có đơn 2 SKU mà cả 2 đều SKU rỗng (NOSKU + NOSKU)
      // → unique_key trùng nhau → Postgres ném lỗi "ON CONFLICT DO UPDATE cannot affect row a second time"
      // → thêm suffix _2, _3... cho các dòng trùng key
      // ============================================================
      const seenKeys = new Map<string, number>();
      allRows.forEach(r => {
        const baseKey = r.unique_key;
        const count = seenKeys.get(baseKey) || 0;
        seenKeys.set(baseKey, count + 1);
        if (count > 0) {
          // Đây là dòng thứ 2+ với cùng key → thêm suffix
          r.unique_key = `${baseKey}_${count + 1}`;
        }
      });

      // ============================================================
      // DEDUPE phí cho đơn nhiều dòng (Shopee lặp phí ở mỗi dòng)
      // Chỉ giữ phí ở dòng có total_paid cao nhất
      // ============================================================
      const byOrderId = new Map<string, Order[]>();
      allRows.forEach(r => {
        const arr = byOrderId.get(r.order_id) || [];
        arr.push(r);
        byOrderId.set(r.order_id, arr);
      });
      let dedupedCount = 0;
      byOrderId.forEach((lines) => {
        if (lines.length <= 1) return;
        // Dòng chính = dòng có "Giá trị ĐH" cao nhất (Giá ưu đãi × SL − Mã giảm Shop)
        // Voucher Shop chỉ tính 1 lần ở cấp đơn → lấy max của shop_voucher (đỉnh) làm voucher chung
        // Để đơn giản: orderValue dòng = price_deal × qty (chưa trừ voucher) đủ để so sánh
        const orderValueOf = (l: Order) => (l.price_deal || 0) * (l.quantity || 1);
        let mainIdx = 0;
        let maxVal = orderValueOf(lines[0]);
        for (let i = 1; i < lines.length; i++) {
          const v = orderValueOf(lines[i]);
          if (v > maxVal) {
            maxVal = v;
            mainIdx = i;
          }
        }
        lines.forEach((line, i) => {
          if (i !== mainIdx) {
            line.fee_fix = 0;
            line.fee_service = 0;
            line.fee_payment = 0;
            dedupedCount++;
          }
        });
      });

      const existingKeys = new Set(orders.map(o => o.unique_key));
      allRows.forEach(r => {
        if (existingKeys.has(r.unique_key)) updated++; else added++;
      });

      const BATCH = 500;
      const payload = allRows.map(r => ({ ...r, user_id: user.id }));
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase
          .from('orders')
          .upsert(slice, { onConflict: 'user_id,unique_key', ignoreDuplicates: false });
        if (error) throw error;
      }

      // Tự sync SKU mới vào products
      const skuMap = new Map<string, { sku: string; name: string; variation: string }>();
      allRows.forEach(r => {
        if (!r.sku || r.sku === 'NOSKU') return;
        if (!skuMap.has(r.sku)) {
          skuMap.set(r.sku, { sku: r.sku, name: r.product_name || '', variation: r.variation || '' });
        }
      });
      const { data: existingProds } = await supabase.from('products').select('sku');
      const existingSkus = new Set((existingProds || []).map(p => p.sku));
      const newProducts = Array.from(skuMap.values())
        .filter(p => !existingSkus.has(p.sku))
        .map(p => ({ ...p, user_id: user.id, stock_initial: 0, cost: 0, price: 0, unit: 'cái' }));
      if (newProducts.length) {
        await supabase.from('products').upsert(newProducts, { onConflict: 'user_id,sku', ignoreDuplicates: true });
      }

      setAlert({
        type: 'success',
        text: `✓ Đã import ${total} dòng — ${added} đơn mới, ${updated} đơn cập nhật${
          newProducts.length ? `, ${newProducts.length} SKU mới đồng bộ vào kho` : ''
        }${dedupedCount ? ` • Đã chống lặp phí cho ${dedupedCount} dòng phụ` : ''}`
      });

      const fresh = await fetchAll(supabase as any, 'orders', { orderBy: 'date_order', ascending: false });
      setOrders(fresh);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ============ EXPORT ============
  const handleExport = () => {
    if (!filtered.length) { window.alert('Không có dữ liệu'); return; }
    const rows = filtered.map(r => ({
      'Ngày đặt': r.o.date_order,
      'Sàn': r.o.platform,
      'Mã đơn': r.o.order_id,
      'Trạng thái': r.o.status,
      'Sản phẩm': r.o.product_name,
      'SKU': r.o.sku,
      'Số lượng': r.quantity,
      'Giá bán': r.price,
      'Giá trị ĐH': r.orderValue,
      'Phí TikTok': r.totalFee,
      'Phí Shopee': r.feeTTLK,
      'Doanh thu': r.shopeePayout ?? '',
      'Sàn thanh toán': r.shopeePayout ?? '',
      '% phí': r.feePercent !== null ? +r.feePercent.toFixed(1) : '',
      'Giá vốn HB': r.cogs,
      'Lợi nhuận': r.profit ?? '',
      'TT THHT': r.isReturned ? 'THHT' : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Đơn hàng');
    XLSX.writeFile(wb, 'don-hang-' + Date.now() + '.xlsx');
  };

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Đơn hàng</h1>
      <p className="text-sm text-gray-500 mb-5">Import file Shopee/TikTok mỗi ngày — đơn cũ tự cập nhật, đơn mới được thêm</p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImport} />
        <button className="btn btn-primary" disabled={importing} onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {importing ? 'Đang import...' : 'Import Shopee Order'}
        </button>

        <input ref={reconFileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImportRecon} />
        <button
          className="btn"
          style={{ background: '#10b981', color: 'white' }}
          disabled={importingRecon}
          onClick={() => reconFileRef.current?.click()}
          title="Import Transaction Report từ Shopee Ví để đối soát"
        >
          <Upload size={15} /> {importingRecon ? 'Đang import...' : 'Import Ví Shopee'}
        </button>

        <input ref={tiktokFileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImportTiktok} />
        <button
          className="btn"
          style={{ background: '#111827', color: 'white' }}
          disabled={importingTiktok}
          onClick={() => tiktokFileRef.current?.click()}
          title="Import file đơn hàng TikTokShop"
        >
          <Upload size={15} /> {importingTiktok ? 'Đang import...' : 'Import TiktokShop Order'}
        </button>

        <input ref={tiktokReconFileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImportTiktokRecon} />
        <button
          className="btn"
          style={{ background: '#374151', color: 'white' }}
          disabled={importingTiktokRecon}
          onClick={() => tiktokReconFileRef.current?.click()}
          title="Import file đối soát tài chính TikTokShop (cần thiết bản về sau)"
        >
          <Upload size={15} /> {importingTiktokRecon ? 'Đang import...' : 'Import Ví Tiktokshop'}
        </button>

        <select className="input" value={dateRange} onChange={e => { setDateRange(e.target.value); setPage(1); }}>
          <option value="all">Tất cả thời gian</option>
          <option value="today">Hôm nay</option>
          <option value="7days">7 ngày qua</option>
          <option value="30days">30 ngày qua</option>
          <option value="month">Tháng này</option>
          <option value="year">Năm này</option>
          <option value="custom">Tùy chọn ngày...</option>
        </select>
        {dateRange === 'custom' && (
          <>
            <input type="date" className="input" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
            <span className="text-gray-400 text-sm">đến</span>
            <input type="date" className="input" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }} />
          </>
        )}

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-64" placeholder="Tìm mã đơn, SP, SKU..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {activeFilterCount > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={clearAllFilters}>
            <X size={14} /> Xóa {activeFilterCount} bộ lọc cột
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={14} /> Xuất Excel
        </button>
        <button className="btn btn-secondary btn-sm" onClick={reset} title="Reset độ rộng các cột về mặc định">
          <RotateCcw size={13} /> Reset cột
        </button>
      </div>

      {alert && (
        <div className={`mb-4 px-4 py-3 rounded-md text-sm ${
          alert.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          alert.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>{alert.text}</div>
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="tbl orders-tbl" style={{ width: cols.reduce((s, c) => s + c.width, 0) }}>
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead><tr>
            <ColHeader label="Ngày đặt" colKey="date" width={colW('date')} onResize={w => setWidth('date', w)}
              filterable filterType="date"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Sàn" colKey="platform" width={colW('platform')} onResize={w => setWidth('platform', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.platform)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Mã đơn" colKey="orderId" width={colW('orderId')} onResize={w => setWidth('orderId', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Trạng thái" colKey="status" width={colW('status')} onResize={w => setWidth('status', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.status)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Sản phẩm" colKey="product" width={colW('product')} onResize={w => setWidth('product', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="SKU" colKey="sku" width={colW('sku')} onResize={w => setWidth('sku', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.sku)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="SL" colKey="quantity" width={colW('quantity')} onResize={w => setWidth('quantity', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá bán" colKey="price" width={colW('price')} onResize={w => setWidth('price', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá trị ĐH" colKey="orderValue" width={colW('orderValue')} onResize={w => setWidth('orderValue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Phí TikTok" colKey="fee" width={colW('fee')} onResize={w => setWidth('fee', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Phí Shopee" colKey="feeTTLK" width={colW('feeTTLK')} onResize={w => setWidth('feeTTLK', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Doanh thu" colKey="revenue" width={colW('revenue')} onResize={w => setWidth('revenue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Sàn TT" colKey="shopeePayout" width={colW('shopeePayout')} onResize={w => setWidth('shopeePayout', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="% phí" colKey="diff" width={colW('diff')} onResize={w => setWidth('diff', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá vốn HB" colKey="cogs" width={colW('cogs')} onResize={w => setWidth('cogs', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Lợi nhuận" colKey="profit" width={colW('profit')} onResize={w => setWidth('profit', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="TT THHT" colKey="returnStatus" width={colW('returnStatus')} noResize
              filterable filterType="list" filterValues={['THHT', 'Bình thường']}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
          </tr></thead>
          <tbody>
            {/* HÀNG TỔNG CỘNG - hiển thị tổng theo bộ lọc hiện tại */}
            <tr className="totals-row">
              <td className="font-semibold text-xs">TỔNG ({filtered.length})</td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td className="text-right font-semibold">{fmt(totals.totalQty)}</td>
              <td></td>
              <td className="text-right font-semibold">{fmt(totals.totalOrderValue)}</td>
              <td className="text-right font-semibold text-yellow-600">{fmt(Math.abs(totals.totalFee))}</td>
              <td className="text-right font-semibold text-orange-600">{fmt(Math.abs(totals.totalFeeTTLK))}</td>
              <td className={`text-right font-semibold ${totals.totalShopeePayout < 0 ? 'text-red-600' : ''}`}>
                {totals.countShopeePayout > 0 ? fmt(totals.totalShopeePayout) : <span className="text-gray-300">—</span>}
              </td>
              <td className={`text-right font-semibold ${totals.totalShopeePayout < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                {totals.countShopeePayout > 0 ? fmt(totals.totalShopeePayout) : <span className="text-gray-300">—</span>}
              </td>
              <td className="text-right font-semibold text-gray-600">
                {totals.totalOrderValue > 0
                  ? `${Math.abs(((totals.totalFee + totals.totalFeeTTLK) / totals.totalOrderValue) * 100).toFixed(1)}%`
                  : <span className="text-gray-300">—</span>}
              </td>
              <td className="text-right font-semibold">{fmt(totals.totalCogs)}</td>
              <td className={`text-right font-semibold ${totals.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totals.countProfit > 0 ? fmt(totals.totalProfit) : <span className="text-gray-300">—</span>}
              </td>
              <td></td>
            </tr>
            {pageRows.length === 0 && (
              <tr><td colSpan={17} className="text-center text-gray-400 py-12">
                {orders.length === 0 ? 'Chưa có đơn hàng — hãy import file Shopee' : 'Không có đơn khớp bộ lọc'}
              </td></tr>
            )}
            {pageRows.map(r => {
              const o = r.o;
              return (
                <tr key={o.unique_key}>
                  <td className="text-xs">{fmtDate(o.date_order)}</td>
                  <td><span className={`tag ${tagClass(o.platform)}`}>{o.platform === 'shopee' ? 'Shopee' : 'TikTok'}</span></td>
                  <td className="font-medium text-xs">{o.order_id}</td>
                  <td><span className={`tag ${tagClass(r.statusColor)}`}>{r.statusText}</span></td>
                  <td>
                    <div className="truncate" title={o.product_name}>{o.product_name || '-'}</div>
                  </td>
                  <td className="text-xs">{o.sku || '-'}</td>
                  <td className="text-right">{r.quantity}</td>
                  <td className="text-right">{fmt(r.price)}</td>
                  <td className="text-right font-medium">{fmt(r.orderValue)}</td>
                  <td className="text-right">
                    {r.o.platform === 'tiktok' && r.isMainRow && r.totalFee !== 0
                      ? <span className="text-yellow-600">{fmt(Math.abs(r.totalFee))}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right">
                    {r.o.platform === 'shopee' && r.hasPayout && r.isMainRow
                      ? <span className="text-orange-600">{fmt(Math.abs(r.feeTTLK))}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right">
                    {r.shopeePayout !== null
                      ? <span className={`font-medium ${r.shopeePayout < 0 ? 'text-red-600' : ''}`}>{fmt(r.shopeePayout)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right">
                    {r.shopeePayout !== null
                      ? <span className={`font-medium ${r.shopeePayout < 0 ? 'text-red-600' : 'text-blue-600'}`}>{fmt(r.shopeePayout)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right">
                    {r.feePercent !== null ? (
                      <span className={`font-medium ${
                        r.feePercent > 30 ? 'text-red-600'
                          : r.feePercent > 15 ? 'text-orange-600'
                          : 'text-gray-600'
                      }`}>
                        {r.feePercent.toFixed(1)}%
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right">{(r.isCancelled || r.isReturned || r.cogs === 0) ? <span className="text-gray-300">—</span> : fmt(r.cogs)}</td>
                  <td className={`text-right font-medium ${
                    r.profit === null ? '' :
                    r.profit >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {r.profit === null ? <span className="text-gray-300">—</span> : fmt(r.profit)}
                  </td>
                  <td>
                    {r.isReturned
                      ? <span className="tag bg-red-100 text-red-700">THHT</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-500">{filtered.length.toLocaleString('vi-VN')} đơn{activeFilterCount > 0 && ` (đã lọc từ ${orders.length})`}</div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <ChevronLeft size={14} /> Trước
          </button>
          <span className="text-sm text-gray-500">Trang {page}/{totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Sau <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ COMPONENT: HEADER CỘT CÓ FILTER ============
type ColHeaderProps = {
  label: string;
  colKey: string;
  width: number;
  onResize?: (w: number) => void;
  align?: 'left' | 'right';
  noResize?: boolean;
  filterable?: boolean;
  filterType?: 'list' | 'number' | 'text' | 'date';
  filterValues?: string[];
  filters?: Record<string, ColFilter>;
  setFilters?: (f: Record<string, ColFilter>) => void;
  open?: string | null;
  setOpen?: (k: string | null) => void;
  onPageChange?: () => void;
};

function ColHeader({
  label, colKey, width, onResize, align, noResize,
  filterable, filterType, filterValues, filters, setFilters, open, setOpen, onPageChange,
}: ColHeaderProps) {
  const f = filters?.[colKey];
  const hasFilter = !!f && (
    (f.type === 'list' && f.selected.size > 0) ||
    (f.type === 'number' && (f.min !== undefined || f.max !== undefined)) ||
    (f.type === 'date' && (f.from !== undefined || f.to !== undefined))
  );
  const isOpen = open === colKey;

  return (
    <th className={align === 'right' ? 'text-right' : ''}>
      <div className="flex items-center gap-1" style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <span>{label}</span>
        {filterable && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen?.(isOpen ? null : colKey); }}
            className={`filter-btn ${hasFilter ? 'active' : ''}`}
            title={hasFilter ? 'Đang lọc cột này' : 'Lọc'}
          >
            <Filter size={11} />
          </button>
        )}
      </div>
      {isOpen && filterable && (
        <FilterPopup
          colKey={colKey}
          type={filterType!}
          values={filterValues}
          current={f}
          onApply={(newFilter) => {
            const next = { ...(filters || {}) };
            if (newFilter) next[colKey] = newFilter;
            else delete next[colKey];
            setFilters?.(next);
            setOpen?.(null);
            onPageChange?.();
          }}
          onClose={() => setOpen?.(null)}
        />
      )}
      {!noResize && onResize && <ResizeHandle currentWidth={width} onResize={onResize} />}
    </th>
  );
}

// ============ COMPONENT: POPUP FILTER ============
type FilterPopupProps = {
  colKey: string;
  type: 'list' | 'number' | 'text' | 'date';
  values?: string[];
  current?: ColFilter;
  onApply: (f: ColFilter | null) => void;
  onClose: () => void;
};

function FilterPopup({ type, values, current, onApply, onClose }: FilterPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // Click outside để đóng
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  // ===== LIST FILTER (checkbox) =====
  if (type === 'list') {
    const [selected, setSelected] = useState<Set<string>>(
      current?.type === 'list' ? new Set(current.selected) : new Set()
    );
    const [searchVal, setSearchVal] = useState('');
    const all = (values || []).filter(v => norm(v).includes(norm(searchVal)));
    const allSelected = selected.size === 0; // empty = all
    const toggleOne = (v: string) => {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v); else next.add(v);
      setSelected(next);
    };
    const selectAll = () => setSelected(new Set());
    const selectNone = () => setSelected(new Set(values || []));

    return (
      <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
        <input className="input input-sm w-full mb-2" placeholder="Tìm trong giá trị..." value={searchVal}
          onChange={e => setSearchVal(e.target.value)} autoFocus />
        <div className="flex gap-2 mb-2 text-xs">
          <button className="text-brand-500 hover:underline" onClick={selectAll}>Chọn tất cả</button>
          <span className="text-gray-300">|</span>
          <button className="text-brand-500 hover:underline" onClick={selectNone}>Bỏ chọn tất cả</button>
        </div>
        <div className="filter-list">
          {all.length === 0 && <div className="text-xs text-gray-400 p-2 text-center">Không có giá trị</div>}
          {all.map(v => {
            const checked = allSelected ? true : selected.has(v);
            return (
              <label key={v} className="filter-item">
                <input type="checkbox" checked={checked} onChange={() => toggleOne(v)} />
                <span className="truncate" title={v}>{v}</span>
              </label>
            );
          })}
        </div>
        <div className="filter-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => { onApply(null); }}>Xóa lọc</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            onApply(selected.size === 0 ? null : { type: 'list', selected });
          }}>
            <Check size={12} /> Áp dụng
          </button>
        </div>
      </div>
    );
  }

  // ===== NUMBER FILTER (min/max) =====
  if (type === 'number') {
    const [min, setMin] = useState<string>(
      current?.type === 'number' && current.min !== undefined ? String(current.min) : ''
    );
    const [max, setMax] = useState<string>(
      current?.type === 'number' && current.max !== undefined ? String(current.max) : ''
    );
    return (
      <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-gray-500 mb-2">Khoảng giá trị</div>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-gray-500">Từ:</label>
            <input type="number" className="input input-sm w-full" placeholder="Không giới hạn"
              value={min} onChange={e => setMin(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-[11px] text-gray-500">Đến:</label>
            <input type="number" className="input input-sm w-full" placeholder="Không giới hạn"
              value={max} onChange={e => setMax(e.target.value)} />
          </div>
        </div>
        <div className="filter-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onApply(null)}>Xóa lọc</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            const f: ColFilter = { type: 'number' };
            if (min !== '' && !isNaN(+min)) f.min = +min;
            if (max !== '' && !isNaN(+max)) f.max = +max;
            if (f.min === undefined && f.max === undefined) onApply(null);
            else onApply(f);
          }}>
            <Check size={12} /> Áp dụng
          </button>
        </div>
      </div>
    );
  }

  // ===== DATE FILTER (from/to date) =====
  if (type === 'date') {
    // Helper: format Date sang YYYY-MM-DD theo LOCAL timezone (không phải UTC)
    const toLocalYMD = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const today = toLocalYMD(new Date());
    const [from, setFrom] = useState<string>(
      current?.type === 'date' && current.from ? current.from : ''
    );
    const [to, setTo] = useState<string>(
      current?.type === 'date' && current.to ? current.to : ''
    );
    // Quick presets
    const setRange = (days: number) => {
      const d = new Date();
      const toStr = toLocalYMD(d);
      d.setDate(d.getDate() - days + 1);
      const fromStr = toLocalYMD(d);
      setFrom(fromStr);
      setTo(toStr);
    };
    const setMonth = () => {
      const d = new Date();
      const fromStr = toLocalYMD(new Date(d.getFullYear(), d.getMonth(), 1));
      setFrom(fromStr);
      setTo(today);
    };
    return (
      <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-gray-500 mb-2">Khoảng ngày</div>
        <div className="flex flex-wrap gap-1 mb-3 text-xs">
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => { setFrom(today); setTo(today); }}>Hôm nay</button>
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => setRange(7)}>7 ngày</button>
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => setRange(30)}>30 ngày</button>
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={setMonth}>Tháng này</button>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-gray-500">Từ ngày:</label>
            <input type="date" className="input input-sm w-full"
              value={from} onChange={e => setFrom(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-[11px] text-gray-500">Đến ngày:</label>
            <input type="date" className="input input-sm w-full"
              value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        <div className="filter-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onApply(null)}>Xóa lọc</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            const f: ColFilter = { type: 'date' };
            if (from) f.from = from;
            if (to) f.to = to;
            if (f.from === undefined && f.to === undefined) onApply(null);
            else onApply(f);
          }}>
            <Check size={12} /> Áp dụng
          </button>
        </div>
      </div>
    );
  }

  // ===== TEXT FILTER (single input - search contains) =====
  const initial = current?.type === 'list' && current.selected.size > 0
    ? Array.from(current.selected)[0] : '';
  const [text, setText] = useState(initial);
  return (
    <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
      <div className="text-xs text-gray-500 mb-2">Chứa văn bản</div>
      <input className="input input-sm w-full" placeholder="Nhập để tìm..." value={text}
        onChange={e => setText(e.target.value)} autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (!text.trim()) onApply(null);
            else onApply({ type: 'list', selected: new Set([text.trim()]) });
          }
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="filter-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => onApply(null)}>Xóa lọc</button>
        <button className="btn btn-primary btn-sm" onClick={() => {
          if (!text.trim()) onApply(null);
          else onApply({ type: 'list', selected: new Set([text.trim()]) });
        }}>
          <Check size={12} /> Áp dụng
        </button>
      </div>
    </div>
  );
}
