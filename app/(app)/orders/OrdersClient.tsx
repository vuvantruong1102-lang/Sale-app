'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Order } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, findCol, shortStatus, tagClass, parseDate, inRange } from '@/lib/utils';
import { useResizableCols, ResizeHandle, ColDef } from '@/lib/useResizableCols';
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
  reconciliation: { order_id: string; shopee_payout: number; has_adjustment?: boolean }[];
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

  // Tính giá trị derived của mỗi row 1 lần để dùng cho filter + display
  // shopeePayout chỉ hiển thị ở 1 dòng (dòng chính) của mỗi đơn để tránh nhân đôi
  const rowsWithCalc = useMemo(() => {
    // Tìm dòng chính của mỗi đơn (dòng có total_paid cao nhất)
    const mainRowKey = new Map<string, string>(); // order_id -> unique_key dòng chính
    const grouped = new Map<string, Order[]>();
    orders.forEach(o => {
      const arr = grouped.get(o.order_id) || [];
      arr.push(o);
      grouped.set(o.order_id, arr);
    });
    grouped.forEach((lines, oid) => {
      if (lines.length === 1) {
        mainRowKey.set(oid, lines[0].unique_key);
        return;
      }
      let main = lines[0];
      for (const l of lines) {
        if ((l.total_paid || 0) > (main.total_paid || 0)) main = l;
      }
      mainRowKey.set(oid, main.unique_key);
    });

    return orders.map(o => {
      const price = o.price_deal || 0;
      const quantity = o.quantity || 1;
      const orderValue = price * quantity - (o.shop_voucher || 0);
      const totalFee = (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
      const st = shortStatus(o.status || '');

      // Shopee TT chỉ hiển thị ở dòng chính
      const isMainRow = mainRowKey.get(o.order_id) === o.unique_key;
      const hasPayout = payoutMap.has(o.order_id);
      const payoutValue = payoutMap.get(o.order_id) || 0;
      const shopeePayout = isMainRow && hasPayout ? payoutValue : null;

      const isCancelled = st.text === 'Đã hủy';
      const isCompleted = st.text === 'Hoàn thành' || st.text === 'Đã nhận';

      // Phát hiện đơn THHT (Trả hàng/Hoàn tiền):
      // Trạng thái "Hoàn thành" + Shopee TT âm
      const isReturned = isCompleted && hasPayout && payoutValue < 0;

      // ============ DOANH THU ============
      // Đơn THHT: doanh thu = Shopee TT (âm)
      // Đơn hủy thông thường: doanh thu = Shopee TT (âm nếu có), 0 nếu chưa có đối soát
      // Đơn bình thường: doanh thu = orderValue - totalFee - feeTTLK
      let revenue: number;
      let feeTTLK = 0;

      if (isReturned) {
        revenue = isMainRow ? payoutValue : 0;
      } else if (isCancelled) {
        revenue = isMainRow && hasPayout ? payoutValue : 0;
      } else {
        // Phí TTLK = chênh lệch khi Shopee TT < (orderValue - totalFee) trên DÒNG CHÍNH
        // Áp dụng cho cả đơn (đặt ở dòng chính), dòng phụ phí TTLK = 0
        const baseRevenue = orderValue - totalFee; // doanh thu chưa trừ TTLK
        if (isMainRow && hasPayout && payoutValue >= 0 && payoutValue < baseRevenue) {
          feeTTLK = baseRevenue - payoutValue;
        }
        revenue = baseRevenue - feeTTLK;
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

      return {
        o, price, quantity, orderValue, totalFee, feeTTLK, revenue, cogs, profit,
        statusText: st.text, statusColor: st.color,
        shopeePayout, diff, isMainRow, hasPayout, isCancelled, isReturned,
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
      // Helper: kiểm tra date filter (so sánh date-only, không tính giờ)
      const matchDate = (key: string, dateStr: string | null | undefined) => {
        const f = cf[key];
        if (!f || f.type !== 'date') return true;
        if (!dateStr) return false; // không có ngày = không match
        // Convert dateStr (ISO) sang YYYY-MM-DD để so sánh
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const ymd = d.toISOString().slice(0, 10);
        if (f.from && ymd < f.from) return false;
        if (f.to && ymd > f.to) return false;
        return true;
      };

      if (!matchDate('date', o.date_order)) return false;
      if (!matchList('platform', o.platform === 'shopee' ? 'Shopee' : 'TikTok')) return false;
      if (!matchList('status', r.statusText)) return false;
      if (!matchList('sku', o.sku || '(trống)')) return false;
      if (!matchNum('quantity', r.quantity)) return false;
      if (!matchNum('price', r.price)) return false;
      if (!matchNum('orderValue', r.orderValue)) return false;
      if (!matchNum('fee', r.totalFee)) return false;
      if (!matchNum('feeTTLK', r.feeTTLK)) return false;
      if (!matchNum('revenue', r.revenue)) return false;
      if (!matchNum('shopeePayout', r.shopeePayout ?? 0)) return false;
      if (!matchNum('diff', r.diff ?? 0)) return false;
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
        const allRows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
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

        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
          const row = allRows[i] || [];
          const orderId = String(row[c_orderIdx] ?? '').trim();
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
      const { data: fresh } = await supabase
        .from('reconciliation').select('order_id,shopee_payout,has_adjustment');
      setReconciliation(fresh || []);
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
        if (n.includes('hoàn thành') || n.includes('completed')) return 'Hoàn thành';
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
        const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
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

        if (c_orderId === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" không có cột "Order ID"` });
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
          const id = String(r[c_orderId] ?? '').trim();
          if (!id) continue;
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

      const { data: fresh } = await supabase
        .from('orders').select('*').order('date_order', { ascending: false }).limit(20000);
      setOrders(fresh || []);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImportingTiktok(false);
      if (tiktokFileRef.current) tiktokFileRef.current.value = '';
    }
  };

  // ============ IMPORT VÍ TIKTOK (sẽ implement khi có file mẫu) ============
  const handleImportTiktokRecon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.target.value = '';
    setAlert({
      type: 'error',
      text: 'Chức năng "Import Ví TikTok" chưa được cấu hình — vui lòng gửi file tài chính TikTok mẫu để map các cột',
    });
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
        const rows: any[] = XLSX.utils.sheet_to_json(sh, { defval: null, raw: false });
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
        const c_feePay = findCol(headers, 'Phí thanh toán', 'Payment Fee');
        const c_dateOrder = findCol(headers, 'Ngày đặt hàng', 'Order Time');
        const c_dateShip = findCol(headers, 'Ngày gửi hàng', 'Ship Time');
        const c_dateComplete = findCol(headers, 'Thời gian hoàn thành đơn hàng', 'Completed Time');

        if (!c_id) {
          setAlert({ type: 'error', text: `File "${f.name}" không có cột Mã đơn hàng` });
          continue;
        }
        const fn = f.name.toLowerCase();
        const platform = fn.includes('tiktok') || fn.includes('tts') ? 'tiktok' : 'shopee';

        const toIso = (v: any): string | null => {
          const d = parseDate(v);
          return d ? d.toISOString() : null;
        };

        for (const r of rows) {
          const id = String(r[c_id!] ?? '').trim();
          if (!id) continue;
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
          });
          total++;
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Không xác thực được người dùng');

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
        let mainIdx = 0;
        let maxPaid = lines[0].total_paid || 0;
        for (let i = 1; i < lines.length; i++) {
          if ((lines[i].total_paid || 0) > maxPaid) {
            maxPaid = lines[i].total_paid || 0;
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

      const { data: fresh } = await supabase
        .from('orders').select('*').order('date_order', { ascending: false }).limit(20000);
      setOrders(fresh || []);
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
      'Tổng phí': r.totalFee,
      'Phí TTLK': r.feeTTLK,
      'Doanh thu': r.revenue,
      'Sàn thanh toán': r.shopeePayout ?? '',
      'Chênh lệch': r.diff ?? '',
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
            <ColHeader label="Tổng phí" colKey="fee" width={colW('fee')} onResize={w => setWidth('fee', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Phí TTLK" colKey="feeTTLK" width={colW('feeTTLK')} onResize={w => setWidth('feeTTLK', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Doanh thu" colKey="revenue" width={colW('revenue')} onResize={w => setWidth('revenue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Sàn TT" colKey="shopeePayout" width={colW('shopeePayout')} onResize={w => setWidth('shopeePayout', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Chênh lệch" colKey="diff" width={colW('diff')} onResize={w => setWidth('diff', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá vốn HB" colKey="cogs" width={colW('cogs')} onResize={w => setWidth('cogs', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Lợi nhuận" colKey="profit" width={colW('profit')} onResize={w => setWidth('profit', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="TT THHT" colKey="returnStatus" width={colW('returnStatus')} noResize />
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
              <td className="text-right font-semibold text-yellow-600">{fmt(totals.totalFee)}</td>
              <td className="text-right font-semibold text-orange-600">{fmt(totals.totalFeeTTLK)}</td>
              <td className={`text-right font-semibold ${totals.totalRevenue < 0 ? 'text-red-600' : ''}`}>{fmt(totals.totalRevenue)}</td>
              <td className={`text-right font-semibold ${totals.totalShopeePayout < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                {totals.countShopeePayout > 0 ? fmt(totals.totalShopeePayout) : <span className="text-gray-300">—</span>}
              </td>
              <td className={`text-right font-semibold ${totals.totalDiff < 0 ? 'text-red-600' : totals.totalDiff > 0 ? 'text-green-600' : ''}`}>
                {totals.countShopeePayout > 0 ? `${totals.totalDiff > 0 ? '+' : ''}${fmt(totals.totalDiff)}` : <span className="text-gray-300">—</span>}
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
                  <td className="text-right text-yellow-600">{fmt(r.totalFee)}</td>
                  <td className="text-right">
                    {r.feeTTLK > 0
                      ? <span className="text-orange-600">{fmt(r.feeTTLK)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`text-right font-medium ${
                    r.revenue < 0 ? 'text-red-600' :
                    (r.isCancelled || r.isReturned) ? 'text-gray-400' :
                    ''
                  }`}>{fmt(r.revenue)}</td>
                  <td className="text-right">
                    {r.shopeePayout !== null
                      ? <span className={`font-medium ${r.shopeePayout < 0 ? 'text-red-600' : 'text-blue-600'}`}>{fmt(r.shopeePayout)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right">
                    {r.diff !== null ? (
                      <span className={`font-medium ${
                        Math.abs(r.diff) < 1 ? 'text-gray-500'
                          : r.diff > 0 ? 'text-green-600'
                          : 'text-red-600'
                      }`}>
                        {r.diff > 0 ? '+' : ''}{fmt(r.diff)}
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
    const today = new Date().toISOString().slice(0, 10);
    const [from, setFrom] = useState<string>(
      current?.type === 'date' && current.from ? current.from : ''
    );
    const [to, setTo] = useState<string>(
      current?.type === 'date' && current.to ? current.to : ''
    );
    // Quick presets
    const setRange = (days: number) => {
      const d = new Date();
      const toStr = d.toISOString().slice(0, 10);
      d.setDate(d.getDate() - days + 1);
      const fromStr = d.toISOString().slice(0, 10);
      setFrom(fromStr);
      setTo(toStr);
    };
    const setMonth = () => {
      const d = new Date();
      const fromStr = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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
