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
  { key: 'date',       width: 120, minWidth: 90 },
  { key: 'platform',   width: 80,  minWidth: 60 },
  { key: 'orderId',    width: 140, minWidth: 100 },
  { key: 'carrier',    width: 110, minWidth: 70 },
  { key: 'package',    width: 150, minWidth: 80 },
  { key: 'status',     width: 105, minWidth: 70 },
  { key: 'product',    width: 280, minWidth: 120 },
  { key: 'sku',        width: 95,  minWidth: 60 },
  { key: 'price',      width: 100, minWidth: 80 },
  { key: 'fee',        width: 95,  minWidth: 80 },
  { key: 'revenue',    width: 105, minWidth: 80 },
  { key: 'cogs',       width: 100, minWidth: 80 },
  { key: 'profit',     width: 105, minWidth: 80 },
  { key: 'invoice',    width: 80,  minWidth: 60 },
];

// Type cho mỗi col filter
// - 'list': checkbox danh sách value (text/category)
// - 'number': range min/max
type ColFilter =
  | { type: 'list'; selected: Set<string> }   // empty Set = ALL
  | { type: 'number'; min?: number; max?: number };

type Props = {
  initialOrders: Order[];
  products: { sku: string; cost: number }[];
};

export default function OrdersClient({ initialOrders, products }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [dateRange, setDateRange] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [alert, setAlert] = useState<{ type: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Tính giá trị derived của mỗi row 1 lần để dùng cho filter + display
  const rowsWithCalc = useMemo(() => orders.map(o => {
    const price = (o.price_deal || 0) - (o.shop_voucher || 0);
    const totalFee = (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
    const revenue = price - totalFee;
    const cogs = (costMap.get(o.sku || '') || 0) * (o.quantity || 1);
    const profit = revenue - cogs;
    const st = shortStatus(o.status || '');
    return { o, price, totalFee, revenue, cogs, profit, statusText: st.text, statusColor: st.color };
  }), [orders, costMap]);

  // Tập value duy nhất cho từng cột list-type (dùng cho dropdown checkbox)
  const uniqueValues = useMemo(() => ({
    platform: new Set(orders.map(o => o.platform === 'shopee' ? 'Shopee' : 'TikTok')),
    carrier: new Set(orders.map(o => o.carrier || '(trống)').sort()),
    status: new Set(rowsWithCalc.map(r => r.statusText).sort()),
    sku: new Set(orders.map(o => o.sku || '(trống)').sort()),
    invoice: new Set(['Đã xuất', 'Chưa']),
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

      if (!matchList('platform', o.platform === 'shopee' ? 'Shopee' : 'TikTok')) return false;
      if (!matchList('carrier', o.carrier || '(trống)')) return false;
      if (!matchList('status', r.statusText)) return false;
      if (!matchList('sku', o.sku || '(trống)')) return false;
      if (!matchList('invoice', o.invoice_issued ? 'Đã xuất' : 'Chưa')) return false;
      if (!matchNum('price', r.price)) return false;
      if (!matchNum('fee', r.totalFee)) return false;
      if (!matchNum('revenue', r.revenue)) return false;
      if (!matchNum('cogs', r.cogs)) return false;
      if (!matchNum('profit', r.profit)) return false;

      // Filter text cho cột Mã đơn, Mã kiện, Sản phẩm (single text search)
      const cf_orderId = cf['orderId'];
      if (cf_orderId && cf_orderId.type === 'list' && cf_orderId.selected.size > 0) {
        const q = norm(Array.from(cf_orderId.selected)[0]);
        if (!norm(o.order_id).includes(q)) return false;
      }
      const cf_pkg = cf['package'];
      if (cf_pkg && cf_pkg.type === 'list' && cf_pkg.selected.size > 0) {
        const q = norm(Array.from(cf_pkg.selected)[0]);
        if (!norm(o.package_id).includes(q)) return false;
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
    return f.min !== undefined || f.max !== undefined;
  }).length;

  const clearAllFilters = () => {
    setColFilters({});
    setPage(1);
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
      'ĐVVC': r.o.carrier,
      'Mã kiện': r.o.package_id,
      'Trạng thái': r.o.status,
      'Sản phẩm': r.o.product_name,
      'SKU': r.o.sku,
      'Số lượng': r.o.quantity,
      'Giá bán': r.price,
      'Tổng phí': r.totalFee,
      'Doanh thu': r.revenue,
      'Giá vốn HB': r.cogs,
      'Lợi nhuận': r.profit,
      'Đã xuất HĐ': r.o.invoice_issued ? 'Có' : 'Không',
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
          <Upload size={15} /> {importing ? 'Đang import...' : 'Import file đơn hàng'}
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
            <ColHeader label="Ngày đặt" colKey="date" width={colW('date')} onResize={w => setWidth('date', w)} />
            <ColHeader label="Sàn" colKey="platform" width={colW('platform')} onResize={w => setWidth('platform', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.platform)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Mã đơn" colKey="orderId" width={colW('orderId')} onResize={w => setWidth('orderId', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="ĐVVC" colKey="carrier" width={colW('carrier')} onResize={w => setWidth('carrier', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.carrier)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Mã kiện" colKey="package" width={colW('package')} onResize={w => setWidth('package', w)}
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
            <ColHeader label="Giá bán" colKey="price" width={colW('price')} onResize={w => setWidth('price', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Tổng phí" colKey="fee" width={colW('fee')} onResize={w => setWidth('fee', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Doanh thu" colKey="revenue" width={colW('revenue')} onResize={w => setWidth('revenue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá vốn HB" colKey="cogs" width={colW('cogs')} onResize={w => setWidth('cogs', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Lợi nhuận" colKey="profit" width={colW('profit')} onResize={w => setWidth('profit', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="HĐ" colKey="invoice" width={colW('invoice')} noResize
              filterable filterType="list" filterValues={Array.from(uniqueValues.invoice)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={14} className="text-center text-gray-400 py-12">
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
                  <td className="text-xs">{o.carrier || '-'}</td>
                  <td className="text-xs">{o.package_id || '-'}</td>
                  <td><span className={`tag ${tagClass(r.statusColor)}`}>{r.statusText}</span></td>
                  <td>
                    <div className="truncate" title={o.product_name}>{o.product_name || '-'}</div>
                    {o.quantity && o.quantity > 1 && <span className="text-xs text-gray-400">×{o.quantity}</span>}
                  </td>
                  <td className="text-xs">{o.sku || '-'}</td>
                  <td className="text-right">{fmt(r.price)}</td>
                  <td className="text-right text-yellow-600">{fmt(r.totalFee)}</td>
                  <td className="text-right">{fmt(r.revenue)}</td>
                  <td className="text-right">{r.cogs > 0 ? fmt(r.cogs) : <span className="text-gray-300">—</span>}</td>
                  <td className={`text-right font-medium ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {r.cogs > 0 ? fmt(r.profit) : <span className="text-gray-300">—</span>}
                  </td>
                  <td>{o.invoice_issued
                    ? <span className="tag bg-green-100 text-green-700">✓</span>
                    : <span className="tag bg-gray-100 text-gray-500">Chưa</span>}</td>
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
  filterType?: 'list' | 'number' | 'text';
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
    (f.type === 'number' && (f.min !== undefined || f.max !== undefined))
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
  type: 'list' | 'number' | 'text';
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
