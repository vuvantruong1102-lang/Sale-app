'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, shortStatus, tagClass } from '@/lib/utils';
import { Order, Return } from '@/lib/types';
import { Download, Search, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useResizableCols, ColDef } from '@/lib/useResizableCols';
import { ColHeader, ColFilter } from '@/components/ColHeader';

type InvStatus = {
  order_id: string;
  invoice_no?: string;
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
  orderValue: number;
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
};

const DEFAULT_COLS: ColDef[] = [
  { key: 'date',                width: 120, minWidth: 90 },
  { key: 'platform',            width: 80,  minWidth: 60 },
  { key: 'orderId',             width: 140, minWidth: 100 },
  { key: 'product',             width: 240, minWidth: 120 },
  { key: 'sku',                 width: 95,  minWidth: 60 },
  { key: 'price',               width: 100, minWidth: 80 },
  { key: 'quantity',            width: 70,  minWidth: 50 },
  { key: 'orderValue',          width: 110, minWidth: 80 },
  { key: 'refundStatus',        width: 130, minWidth: 100 },
  { key: 'returnedQty',         width: 80,  minWidth: 60 },
  { key: 'orderType',           width: 130, minWidth: 100 },
  { key: 'invoiceNo',           width: 130, minWidth: 100 },
  { key: 'releaseStatus',       width: 140, minWidth: 110 },
  { key: 'adjustmentInvoiceNo', width: 140, minWidth: 110 },
  { key: 'shopReceived',        width: 110, minWidth: 90 },
  { key: 'goodsCondition',      width: 180, minWidth: 130 },
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
    byOrderId.forEach((lines, oid) => {
      const orderValueOf = (l: Order) => (l.price_deal || 0) * (l.quantity || 1) - (l.shop_voucher || 0);
      let main = lines[0];
      let maxVal = orderValueOf(main);
      for (const l of lines) {
        const v = orderValueOf(l);
        if (v > maxVal) { main = l; maxVal = v; }
      }
      const totalQty = lines.reduce((s, l) => s + (l.quantity || 1), 0);
      const totalReturnedQty = lines.reduce((s, l) => s + (l.returned_qty || 0), 0);

      const refundStatus = (main.refund_status || '').trim();
      const cancelReason = (main.cancel_reason || '').trim();
      const isTHHT = !!refundStatus;
      const isFailedDelivery = !isTHHT && /giao hàng thất bại/i.test(cancelReason);
      const st = shortStatus(main.status || '');
      const payout = payoutMap.get(oid) ?? null;
      const isTHHTTiktok = main.platform === 'tiktok'
        && (st.text === 'Hoàn thành')
        && payout !== null && payout < 0;

      if (!isTHHT && !isFailedDelivery && !isTHHTTiktok) return;

      const r = returnMap.get(oid);
      const inv = invStatusMap.get(oid);
      result.push({
        o: main,
        date: main.date_order || '',
        platform: main.platform === 'shopee' ? 'Shopee' : 'TikTok',
        orderId: oid,
        productName: main.product_name || '',
        sku: main.sku || '',
        price: main.price_deal || 0,
        quantity: totalQty,
        orderValue: maxVal,
        refundStatus: refundStatus || (isTHHTTiktok ? 'THHT (TikTok)' : ''),
        returnedQty: totalReturnedQty,
        orderType: (isTHHT || isTHHTTiktok) ? 'THHT' : 'Giao hàng thất bại',
        cancelReason,
        shopeePayout: payout,
        shopReceived: r?.shop_received || false,
        goodsCondition: r?.goods_condition || '',
        invoiceNo: inv?.invoice_no || '',
        releaseStatus: inv?.release_status || '',
        adjustmentInvoiceNo: inv?.adjustment_invoice_no || '',
      });
    });

    result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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
        if (!matchNum('orderValue', r.orderValue)) return false;
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
      'Giá trị ĐH': r.orderValue,
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
    rows.forEach(r => {
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
            <ColHeader label="Giá trị ĐH" colKey="orderValue" width={colW('orderValue')} onResize={w => setWidth('orderValue', w)} align="right"
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
            <ColHeader label="TT phát hành HĐ" colKey="releaseStatus" width={colW('releaseStatus')} onResize={w => setWidth('releaseStatus', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.releaseStatuses)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Số HĐ điều chỉnh" colKey="adjustmentInvoiceNo" width={colW('adjustmentInvoiceNo')} onResize={w => setWidth('adjustmentInvoiceNo', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Shop đã nhận" colKey="shopReceived" width={colW('shopReceived')} onResize={w => setWidth('shopReceived', w)}
              filterable filterType="list" filterValues={['Đã nhận', 'Chưa nhận']}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
            <ColHeader label="Tình trạng hàng hoàn" colKey="goodsCondition" width={colW('goodsCondition')} onResize={w => setWidth('goodsCondition', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} />
          </tr></thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={16} className="text-center text-gray-400 py-12">Không có đơn nào</td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.orderId}>
                <td className="text-xs">{fmtDate(r.date)}</td>
                <td>
                  <span className={`tag ${tagClass(r.platform === 'Shopee' ? 'shopee' : 'tiktok')}`}>{r.platform}</span>
                </td>
                <td className="font-medium text-xs">{r.orderId}</td>
                <td>
                  <div className="truncate" title={r.productName}>{r.productName || '-'}</div>
                </td>
                <td className="text-xs">{r.sku || '-'}</td>
                <td className="text-right">{fmt(r.price)}</td>
                <td className="text-right">{r.quantity}</td>
                <td className="text-right font-medium">{fmt(r.orderValue)}</td>
                <td className="text-xs">
                  {r.refundStatus
                    ? <span className="tag bg-red-100 text-red-700">{r.refundStatus}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="text-right">{r.returnedQty || <span className="text-gray-300">—</span>}</td>
                <td>
                  <span className={`tag ${r.orderType === 'THHT' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                    {r.orderType}
                  </span>
                </td>
                <td className="text-xs font-mono">
                  {r.invoiceNo || <span className="text-gray-300">—</span>}
                </td>
                <td>
                  {r.releaseStatus
                    ? <span className={`tag ${
                        norm(r.releaseStatus).includes('đã phát hành') || norm(r.releaseStatus).includes('đã cấp mã')
                          ? 'bg-green-100 text-green-700'
                          : norm(r.releaseStatus).includes('hủy')
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>{r.releaseStatus}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td>
                  <input type="text" className="input input-sm w-full text-xs"
                    placeholder="Nhập số HĐ ĐC..."
                    defaultValue={r.adjustmentInvoiceNo}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== r.adjustmentInvoiceNo) updateAdjustmentInvoiceNo(r.orderId, v);
                    }}
                  />
                </td>
                <td className="text-center">
                  <button
                    onClick={() => toggleShopReceived(r.orderId, r.shopReceived)}
                    className={`inline-flex items-center justify-center w-6 h-6 rounded border ${
                      r.shopReceived
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'bg-white border-gray-300 hover:border-gray-400'
                    }`}
                    title={r.shopReceived ? 'Đã nhận - click để bỏ' : 'Chưa nhận - click để đánh dấu'}
                  >
                    {r.shopReceived ? <Check size={14} /> : null}
                  </button>
                </td>
                <td>
                  <input type="text" className="input input-sm w-full text-xs"
                    placeholder="Vd: Còn mới, Hỏng, Thiếu..."
                    defaultValue={r.goodsCondition}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== r.goodsCondition) updateCondition(r.orderId, v);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Hiển thị {filtered.length} đơn (lọc từ tổng {rows.length} đơn cần xử lý)
      </div>
    </div>
  );
}
