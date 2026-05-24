'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, shortStatus, tagClass, parseDate } from '@/lib/utils';
import { Order, Return } from '@/lib/types';
import { Download, Search, Check, Upload, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useResizableCols, ColDef } from '@/lib/useResizableCols';
import { ColHeader, ColFilter } from '@/components/ColHeader';

type InvStatus = {
  order_id: string;
  invoice_no?: string;
  invoice_value?: number;
  release_status?: string;
  adjustment_invoice_no?: string;
};

type Props = {
  initialOrders: Order[];
  initialReturns: Return[];
  reconciliation: { order_id: string; shopee_payout: number; has_adjustment?: boolean }[];
  initialInvStatus: InvStatus[];
};

type Row = {
  o: Order;
  date: string;
  platform: string;
  orderId: string;
  productName: string;
  sku: string;
  price: number;
  quantity: number;
  invoiceValue: number | null;
  refundStatus: string;
  returnedQty: number;
  orderType: 'THHT' | 'Giao hàng thất bại';
  cancelReason: string;
  shopeePayout: number | null;
  shopReceived: boolean;
  goodsCondition: string;
  invoiceNo: string;
  releaseStatus: string;
  adjustmentInvoiceNo: string;
  rowKey: string;           // unique key cho mỗi dòng SKU
  isFirstOfOrder: boolean;  // true nếu là dòng đầu của đơn (để hiển thị các cột chung)
  orderLineCount: number;   // tổng số dòng SKU của đơn (cho rowspan/display)
};

const DEFAULT_COLS: ColDef[] = [
  { key: 'date',                width: 120, minWidth: 90 },
  { key: 'platform',            width: 80,  minWidth: 60 },
  { key: 'orderId',             width: 140, minWidth: 100 },
  { key: 'product',             width: 240, minWidth: 120 },
  { key: 'sku',                 width: 95,  minWidth: 60 },
  { key: 'price',               width: 100, minWidth: 80 },
  { key: 'quantity',            width: 70,  minWidth: 50 },
  { key: 'invoiceValue',        width: 120, minWidth: 80 },
  { key: 'refundStatus',        width: 130, minWidth: 100 },
  { key: 'returnedQty',         width: 80,  minWidth: 60 },
  { key: 'orderType',           width: 130, minWidth: 100 },
  { key: 'invoiceNo',           width: 130, minWidth: 100 },
  { key: 'adjustmentInvoiceNo', width: 140, minWidth: 110 },
  { key: 'goodsCondition',      width: 180, minWidth: 130 },
  { key: 'warning',             width: 200, minWidth: 130 },
];

export default function ReturnsClient({ initialOrders, initialReturns, reconciliation, initialInvStatus }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [orders] = useState<Order[]>(initialOrders);
  const [returns, setReturns] = useState<Return[]>(initialReturns);
  const [invStatus, setInvStatus] = useState<InvStatus[]>(initialInvStatus);
  const [search, setSearch] = useState('');

  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  const { cols, setWidth, reset } = useResizableCols('returns-col-widths', DEFAULT_COLS);
  const colW = (k: string) => cols.find(c => c.key === k)?.width || 100;

  const payoutMap = useMemo(() => {
    const m = new Map<string, number>();
    reconciliation.forEach(r => m.set(r.order_id, r.shopee_payout));
    return m;
  }, [reconciliation]);

  const returnMap = useMemo(() => {
    const m = new Map<string, Return>();
    returns.forEach(r => m.set(r.order_id, r));
    return m;
  }, [returns]);

  const invStatusMap = useMemo(() => {
    const m = new Map<string, InvStatus>();
    invStatus.forEach(r => m.set(r.order_id, r));
    return m;
  }, [invStatus]);

  const rows: Row[] = useMemo(() => {
    const byOrderId = new Map<string, Order[]>();
    orders.forEach(o => {
      const arr = byOrderId.get(o.order_id) || [];
      arr.push(o);
      byOrderId.set(o.order_id, arr);
    });

    const result: Row[] = [];
    // Sort các order_id theo date DESC để hiển thị đúng thứ tự
    const orderEntries = Array.from(byOrderId.entries());
    orderEntries.sort((a, b) => {
      const da = a[1][0]?.date_order || '';
      const db = b[1][0]?.date_order || '';
      return db.localeCompare(da);
    });

    for (const [oid, lines] of orderEntries) {
      // Chọn dòng chính (total_paid cao nhất) — để check status THHT
      let main = lines[0];
      for (const l of lines) {
        if ((l.total_paid || 0) > (main.total_paid || 0)) main = l;
      }
      const refundStatus = (main.refund_status || '').trim();
      const cancelReason = (main.cancel_reason || '').trim();
      const isTHHT = !!refundStatus;
      const isFailedDelivery = !isTHHT && /giao hàng thất bại/i.test(cancelReason);
      const st = shortStatus(main.status || '');
      const payout = payoutMap.get(oid) ?? null;
      const isTHHTTiktok = main.platform === 'tiktok'
        && (st.text === 'Hoàn thành')
        && payout !== null && payout < 0;

      if (!isTHHT && !isFailedDelivery && !isTHHTTiktok) continue;

      const r = returnMap.get(oid);
      const inv = invStatusMap.get(oid);
      const invoiceValue = inv?.invoice_value ?? null;

      // Sort lines: dòng có giá > 0 lên trước, dòng 0đ (quà tặng) xuống cuối
      // Đảm bảo "dòng đầu" của đơn không phải dòng 0đ
      const sortedLines = [...lines].sort((a, b) => {
        const pa = a.price_deal || 0;
        const pb = b.price_deal || 0;
        return pb - pa;
      });

      sortedLines.forEach((line, idx) => {
        const isFirst = idx === 0;
        result.push({
          o: line,
          date: main.date_order || '',
          platform: main.platform === 'shopee' ? 'Shopee' : 'TikTok',
          orderId: oid,
          productName: line.product_name || '',
          sku: line.sku || '',
          price: line.price_deal || 0,
          quantity: line.quantity || 1,
          invoiceValue,
          refundStatus: refundStatus || (isTHHTTiktok ? 'THHT (TikTok)' : ''),
          returnedQty: line.returned_qty || 0,
          orderType: (isTHHT || isTHHTTiktok) ? 'THHT' : 'Giao hàng thất bại',
          cancelReason,
          shopeePayout: payout,
          shopReceived: r?.shop_received || false,
          goodsCondition: r?.goods_condition || '',
          invoiceNo: inv?.invoice_no || '',
          releaseStatus: inv?.release_status || '',
          adjustmentInvoiceNo: inv?.adjustment_invoice_no || '',
          rowKey: line.unique_key || `${oid}__${idx}`,
          isFirstOfOrder: isFirst,
          orderLineCount: sortedLines.length,
        });
      });
    }

    return result;
  }, [orders, payoutMap, returnMap, invStatusMap]);

  const uniqueValues = useMemo(() => {
    const platforms = new Set<string>();
    const skus = new Set<string>();
    const refundStatuses = new Set<string>();
    const orderTypes = new Set<string>();
    const releaseStatuses = new Set<string>();
    rows.forEach(r => {
      platforms.add(r.platform);
      skus.add(r.sku || '(trống)');
      refundStatuses.add(r.refundStatus || '(trống)');
      orderTypes.add(r.orderType);
      releaseStatuses.add(r.releaseStatus || '(trống)');
    });
    return { platforms, skus, refundStatuses, orderTypes, releaseStatuses };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search) {
      const q = norm(search);
      list = list.filter(r =>
        norm(r.orderId).includes(q) || norm(r.productName).includes(q) || norm(r.sku).includes(q)
      );
    }
    const cf = colFilters;
    if (Object.keys(cf).length > 0) {
      const matchList = (key: string, val: string) => {
        const f = cf[key];
        if (!f || f.type !== 'list' || f.selected.size === 0) return true;
        return f.selected.has(val || '(trống)');
      };
      const matchText = (key: string, val: string) => {
        const f = cf[key];
        if (!f || f.type !== 'list' || f.selected.size === 0) return true;
        const q = Array.from(f.selected)[0];
        return norm(val).includes(norm(q));
      };
      const matchNum = (key: string, val: number) => {
        const f = cf[key];
        if (!f || f.type !== 'number') return true;
        if (f.min !== undefined && val < f.min) return false;
        if (f.max !== undefined && val > f.max) return false;
        return true;
      };
      const matchDate = (key: string, dateStr: string | null | undefined) => {
        const f = cf[key];
        if (!f || f.type !== 'date') return true;
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const ymd = `${y}-${m}-${day}`;
        if (f.from && ymd < f.from) return false;
        if (f.to && ymd > f.to) return false;
        return true;
      };

      list = list.filter(r => {
        if (!matchDate('date', r.date)) return false;
        if (!matchList('platform', r.platform)) return false;
        if (!matchText('orderId', r.orderId)) return false;
        if (!matchText('product', r.productName)) return false;
        if (!matchList('sku', r.sku || '(trống)')) return false;
        if (!matchNum('price', r.price)) return false;
        if (!matchNum('quantity', r.quantity)) return false;
        if (!matchNum('invoiceValue', r.invoiceValue || 0)) return false;
        if (!matchList('refundStatus', r.refundStatus || '(trống)')) return false;
        if (!matchNum('returnedQty', r.returnedQty)) return false;
        if (!matchList('orderType', r.orderType)) return false;
        if (!matchText('invoiceNo', r.invoiceNo)) return false;
        if (!matchList('releaseStatus', r.releaseStatus || '(trống)')) return false;
        if (!matchText('adjustmentInvoiceNo', r.adjustmentInvoiceNo)) return false;
        if (!matchList('shopReceived', r.shopReceived ? 'Đã nhận' : 'Chưa nhận')) return false;
        if (!matchText('goodsCondition', r.goodsCondition)) return false;
        return true;
      });
    }
    return list;
  }, [rows, search, colFilters]);

  const toggleShopReceived = async (orderId: string, current: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const newVal = !current;
    const existing = returns.find(r => r.order_id === orderId);
    if (existing) {
      const { error } = await supabase
        .from('returns')
        .update({ shop_received: newVal })
        .eq('user_id', user.id)
        .eq('order_id', orderId);
      if (error) { window.alert('Lỗi: ' + error.message); return; }
      setReturns(prev => prev.map(r => r.order_id === orderId ? { ...r, shop_received: newVal } : r));
    } else {
      const { data, error } = await supabase
        .from('returns')
        .insert({ user_id: user.id, order_id: orderId, shop_received: newVal })
        .select().single();
      if (error) { window.alert('Lỗi: ' + error.message); return; }
      if (data) setReturns(prev => [...prev, data as Return]);
    }
  };

  const updateCondition = async (orderId: string, newCondition: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const existing = returns.find(r => r.order_id === orderId);
    if (existing) {
      const { error } = await supabase
        .from('returns')
        .update({ goods_condition: newCondition })
        .eq('user_id', user.id)
        .eq('order_id', orderId);
      if (error) { window.alert('Lỗi: ' + error.message); return; }
      setReturns(prev => prev.map(r => r.order_id === orderId ? { ...r, goods_condition: newCondition } : r));
    } else {
      const { data, error } = await supabase
        .from('returns')
        .insert({ user_id: user.id, order_id: orderId, goods_condition: newCondition })
        .select().single();
      if (error) { window.alert('Lỗi: ' + error.message); return; }
      if (data) setReturns(prev => [...prev, data as Return]);
    }
  };

  // ===== Import file "Trả lại hàng bán" (MISA) — điền Số HĐ Điều chỉnh =====
  const returnFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [alert, setAlert] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleImportReturn = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setImporting(true);
    setAlert(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAlert({ type: 'err', text: 'Phiên đăng nhập hết hạn.' }); setImporting(false); return; }

      // Gom map: order_id (cột "Số đơn hàng từ hệ thống khác") -> số hóa đơn (cột "Số hóa đơn")
      const adjByOid = new Map<string, string>();
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
        // tìm dòng header
        let hr = -1;
        for (let i = 0; i < 6; i++) {
          if ((rows[i] || []).some(c => norm(c).includes('số đơn hàng từ hệ thống khác'))) { hr = i; break; }
        }
        if (hr < 0) continue;
        const headers = (rows[hr] || []).map(h => norm(h));
        const c_oid = headers.findIndex(h => h.includes('số đơn hàng từ hệ thống khác'));
        const c_invno = headers.findIndex(h => h === 'số hóa đơn');
        if (c_oid < 0 || c_invno < 0) continue;
        for (let i = hr + 1; i < rows.length; i++) {
          const oid = String(rows[i]?.[c_oid] ?? '').trim();
          const invNo = String(rows[i]?.[c_invno] ?? '').trim();
          if (!oid || !invNo) continue;
          adjByOid.set(oid, invNo);
        }
      }

      if (adjByOid.size === 0) {
        setAlert({ type: 'err', text: 'Không tìm thấy dữ liệu hợp lệ (cần cột "Số đơn hàng từ hệ thống khác" và "Số hóa đơn").' });
        setImporting(false);
        return;
      }

      // Số HĐ điều chỉnh chỉ đến từ file → luôn cập nhật theo file mới nhất
      const toUpsert: any[] = [];
      adjByOid.forEach((invNo, oid) => {
        toUpsert.push({ user_id: user.id, order_id: oid, adjustment_invoice_no: invNo });
      });

      if (toUpsert.length === 0) {
        setAlert({ type: 'ok', text: `Đã khớp ${adjByOid.size} đơn.` });
        setImporting(false);
        if (returnFileRef.current) returnFileRef.current.value = '';
        return;
      }

      const BATCH = 500;
      for (let i = 0; i < toUpsert.length; i += BATCH) {
        const slice = toUpsert.slice(i, i + BATCH);
        const { error } = await supabase
          .from('invoice_status')
          .upsert(slice, { onConflict: 'user_id,order_id', ignoreDuplicates: false });
        if (error) throw error;
      }

      // Tải lại invoice_status
      const { data: fresh } = await supabase.from('invoice_status').select('*');
      setInvStatus((fresh as InvStatus[]) || []);
      setAlert({ type: 'ok', text: `Đã điền số HĐ điều chỉnh cho ${toUpsert.length} đơn.` });
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'err', text: `Lỗi import: ${err?.message || 'không xác định'}` });
    } finally {
      setImporting(false);
      if (returnFileRef.current) returnFileRef.current.value = '';
    }
  };

  const updateAdjustmentInvoiceNo = async (orderId: string, newVal: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const existing = invStatus.find(r => r.order_id === orderId);
    if (existing) {
      const { error } = await supabase
        .from('invoice_status')
        .update({ adjustment_invoice_no: newVal })
        .eq('user_id', user.id)
        .eq('order_id', orderId);
      if (error) { window.alert('Lỗi: ' + error.message); return; }
      setInvStatus(prev => prev.map(r => r.order_id === orderId ? { ...r, adjustment_invoice_no: newVal } : r));
    } else {
      const { data, error } = await supabase
        .from('invoice_status')
        .insert({ user_id: user.id, order_id: orderId, adjustment_invoice_no: newVal })
        .select().single();
      if (error) { window.alert('Lỗi: ' + error.message); return; }
      if (data) setInvStatus(prev => [...prev, data as InvStatus]);
    }
  };

  const handleExport = () => {
    const data = filtered.map(r => ({
      'Ngày đặt': fmtDate(r.date),
      'Sàn': r.platform,
      'Mã đơn': r.orderId,
      'Sản phẩm': r.productName,
      'SKU': r.sku,
      'Giá bán': r.price,
      'SL': r.quantity,
      'Giá trị xuất HĐ': r.invoiceValue ?? '',
      'TT THHT': r.refundStatus,
      'SL hoàn': r.returnedQty,
      'Loại đơn': r.orderType,
      'Số HĐ': r.invoiceNo,
      'TT phát hành HĐ': r.releaseStatus,
      'Số HĐ điều chỉnh': r.adjustmentInvoiceNo,
      'Shop đã nhận': r.shopReceived ? 'Có' : 'Chưa',
      'Tình trạng hàng hoàn': r.goodsCondition,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trả hàng');
    XLSX.writeFile(wb, `tra-hang-${Date.now()}.xlsx`);
  };

  const stats = useMemo(() => {
    let thht = 0, failedDelivery = 0, totalReceived = 0, totalUnreceived = 0;
    // Đếm 1 lần per order (chỉ dòng isFirstOfOrder)
    rows.forEach(r => {
      if (!r.isFirstOfOrder) return;
      if (r.orderType === 'THHT') thht++; else failedDelivery++;
      if (r.shopReceived) totalReceived++; else totalUnreceived++;
    });
    return { thht, failedDelivery, totalReceived, totalUnreceived };
  }, [rows]);

  const totalWidth = cols.reduce((s, c) => s + c.width, 0);

  return (
    <div className="fade-in w-full">
      <h1 className="text-2xl font-bold mb-1">Đơn hủy / Trả hàng</h1>
      <p className="text-sm text-gray-500 mb-5">
        Theo dõi các đơn THHT (Trả hàng/Hoàn tiền) và đơn hủy do giao hàng thất bại
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Tổng đơn THHT</div>
          <div className="text-2xl font-bold text-red-600">{stats.thht}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Giao hàng thất bại</div>
          <div className="text-2xl font-bold text-orange-600">{stats.failedDelivery}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Shop đã nhận</div>
          <div className="text-2xl font-bold text-green-600">{stats.totalReceived}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Chưa nhận</div>
          <div className="text-2xl font-bold text-gray-700">{stats.totalUnreceived}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <button
          className="btn btn-primary"
          onClick={() => returnFileRef.current?.click()}
          disabled={importing}
        >
          <Upload size={15} /> {importing ? 'Đang import…' : 'TT Trả/Hoàn hàng'}
        </button>
        <input ref={returnFileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImportReturn} />
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-full" placeholder="Tìm mã đơn, SP, SKU..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={handleExport}>
          <Download size={15} /> Xuất Excel
        </button>
        <button className="btn btn-secondary" onClick={reset}>Reset cột</button>
        {Object.keys(colFilters).length > 0 && (
          <button className="btn btn-secondary" onClick={() => setColFilters({})}>
            Xóa lọc ({Object.keys(colFilters).length})
          </button>
        )}
      </div>

      {alert && (
        <div className={`mb-4 px-4 py-2.5 rounded-md text-sm ${
          alert.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'
        }`}>
          {alert.text}
        </div>
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="tbl orders-tbl" style={{ width: totalWidth }}>
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead><tr>
            <ColHeader label="Ngày đặt" colKey="date" width={colW('date')} onResize={w => setWidth('date', w)}
              filterable filterType="date"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Sàn" colKey="platform" width={colW('platform')} onResize={w => setWidth('platform', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.platforms)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Mã đơn" colKey="orderId" width={colW('orderId')} onResize={w => setWidth('orderId', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Sản phẩm" colKey="product" width={colW('product')} onResize={w => setWidth('product', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="SKU" colKey="sku" width={colW('sku')} onResize={w => setWidth('sku', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.skus)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Giá bán" colKey="price" width={colW('price')} onResize={w => setWidth('price', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="SL" colKey="quantity" width={colW('quantity')} onResize={w => setWidth('quantity', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Giá trị xuất HĐ" colKey="invoiceValue" width={colW('invoiceValue')} onResize={w => setWidth('invoiceValue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="TT THHT" colKey="refundStatus" width={colW('refundStatus')} onResize={w => setWidth('refundStatus', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.refundStatuses)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="SL hoàn" colKey="returnedQty" width={colW('returnedQty')} onResize={w => setWidth('returnedQty', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Loại đơn" colKey="orderType" width={colW('orderType')} onResize={w => setWidth('orderType', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.orderTypes)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Số HĐ" colKey="invoiceNo" width={colW('invoiceNo')} onResize={w => setWidth('invoiceNo', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Số HĐ điều chỉnh" colKey="adjustmentInvoiceNo" width={colW('adjustmentInvoiceNo')} onResize={w => setWidth('adjustmentInvoiceNo', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Ghi chú" colKey="goodsCondition" width={colW('goodsCondition')} onResize={w => setWidth('goodsCondition', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Cảnh báo" colKey="warning" width={colW('warning')} onResize={w => setWidth('warning', w)} />
          </tr></thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={16} className="text-center text-gray-400 py-12">Không có đơn nào</td></tr>
            )}
            {filtered.map(r => {
              const showOrderCols = r.isFirstOfOrder;
              // Dòng tiếp theo của cùng đơn → bo phía trên nhạt hơn để gộp nhóm trực quan
              const rowClass = showOrderCols
                ? (r.orderLineCount > 1 ? 'border-t-2 border-t-gray-200' : '')
                : 'border-t-transparent';
              return (
                <tr key={r.rowKey} className={rowClass}>
                  <td className="text-xs">{showOrderCols ? fmtDate(r.date) : ''}</td>
                  <td>
                    {showOrderCols
                      ? <span className={`tag ${tagClass(r.platform === 'Shopee' ? 'shopee' : 'tiktok')}`}>{r.platform}</span>
                      : null}
                  </td>
                  <td className="font-medium text-xs">{showOrderCols ? r.orderId : ''}</td>
                  <td>
                    <div className="truncate" title={r.productName}>{r.productName || '-'}</div>
                  </td>
                  <td className="text-xs">{r.sku || '-'}</td>
                  <td className="text-right">{fmt(r.price)}</td>
                  <td className="text-right">{r.quantity}</td>
                  <td className="text-right font-medium">
                    {showOrderCols
                      ? (r.invoiceValue !== null ? fmt(r.invoiceValue) : <span className="text-gray-300">—</span>)
                      : ''}
                  </td>
                  <td className="text-xs">
                    {showOrderCols
                      ? (r.refundStatus
                          ? <span className="tag bg-red-100 text-red-700">{r.refundStatus}</span>
                          : <span className="text-gray-300">—</span>)
                      : ''}
                  </td>
                  <td className="text-right">{r.returnedQty || <span className="text-gray-300">—</span>}</td>
                  <td>
                    {showOrderCols
                      ? <span className={`tag ${r.orderType === 'THHT' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {r.orderType}
                        </span>
                      : ''}
                  </td>
                  <td className="text-xs font-mono">
                    {showOrderCols
                      ? (r.invoiceNo || <span className="text-gray-300">—</span>)
                      : ''}
                  </td>
                  <td>
                    {showOrderCols
                      ? (r.adjustmentInvoiceNo && r.adjustmentInvoiceNo.trim()
                          ? <span className="tag bg-green-100 text-green-700">{r.adjustmentInvoiceNo}</span>
                          : <span className="text-gray-300">—</span>)
                      : ''}
                  </td>
                  <td>
                    {showOrderCols ? (
                      <input type="text" className="input input-sm w-full text-xs"
                        placeholder="Ghi chú..."
                        defaultValue={r.goodsCondition}
                        onBlur={e => {
                          const v = e.target.value.trim();
                          if (v !== r.goodsCondition) updateCondition(r.orderId, v);
                        }}
                      />
                    ) : ''}
                  </td>
                  <td>
                    {showOrderCols
                      ? (!r.adjustmentInvoiceNo || !r.adjustmentInvoiceNo.trim()
                          ? <span className="text-xs text-red-600 flex items-start gap-1">
                              <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> Chưa có số HĐ điều chỉnh
                            </span>
                          : <span className="text-gray-300">—</span>)
                      : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Hiển thị {filtered.length} dòng SP (từ tổng {rows.length} dòng cần xử lý)
      </div>
    </div>
  );
}
