'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, shortStatus, tagClass } from '@/lib/utils';
import { Order, Return } from '@/lib/types';
import { Download, RotateCcw, Search, Check, X } from 'lucide-react';
import * as XLSX from 'xlsx';

type Props = {
  initialOrders: Order[];
  initialReturns: Return[];
  reconciliation: { order_id: string; shopee_payout: number; has_adjustment?: boolean }[];
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
};

export default function ReturnsClient({ initialOrders, initialReturns, reconciliation }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [orders] = useState<Order[]>(initialOrders);
  const [returns, setReturns] = useState<Return[]>(initialReturns);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'THHT' | 'Giao hàng thất bại'>('all');
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'shopee' | 'tiktok'>('all');
  const [filterShopReceived, setFilterShopReceived] = useState<'all' | 'yes' | 'no'>('all');

  // Build lookup payout
  const payoutMap = useMemo(() => {
    const m = new Map<string, number>();
    reconciliation.forEach(r => m.set(r.order_id, r.shopee_payout));
    return m;
  }, [reconciliation]);

  // Build lookup returns
  const returnMap = useMemo(() => {
    const m = new Map<string, Return>();
    returns.forEach(r => m.set(r.order_id, r));
    return m;
  }, [returns]);

  // Lọc các đơn THHT hoặc Đã hủy do giao hàng thất bại
  // Dedupe theo order_id — lấy dòng chính (orderValue cao nhất)
  const rows: Row[] = useMemo(() => {
    // Group theo order_id
    const byOrderId = new Map<string, Order[]>();
    orders.forEach(o => {
      const arr = byOrderId.get(o.order_id) || [];
      arr.push(o);
      byOrderId.set(o.order_id, arr);
    });

    const result: Row[] = [];
    byOrderId.forEach((lines, oid) => {
      // Chọn dòng chính = orderValue cao nhất
      const orderValueOf = (l: Order) => (l.price_deal || 0) * (l.quantity || 1) - (l.shop_voucher || 0);
      let main = lines[0];
      let maxVal = orderValueOf(main);
      for (const l of lines) {
        const v = orderValueOf(l);
        if (v > maxVal) { main = l; maxVal = v; }
      }
      // Tổng số lượng + tổng số lượng hoàn từ tất cả các dòng
      const totalQty = lines.reduce((s, l) => s + (l.quantity || 1), 0);
      const totalReturnedQty = lines.reduce((s, l) => s + (l.returned_qty || 0), 0);

      const refundStatus = (main.refund_status || '').trim();
      const cancelReason = (main.cancel_reason || '').trim();
      const isTHHT = !!refundStatus;
      const isFailedDelivery = !isTHHT && /giao hàng thất bại/i.test(cancelReason);
      // Detect THHT cho TikTok: status Hoàn thành + Sàn TT âm
      const st = shortStatus(main.status || '');
      const payout = payoutMap.get(oid) ?? null;
      const isTHHTTiktok = main.platform === 'tiktok'
        && (st.text === 'Hoàn thành')
        && payout !== null && payout < 0;

      if (!isTHHT && !isFailedDelivery && !isTHHTTiktok) return; // bỏ qua đơn bình thường

      const r = returnMap.get(oid);
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
      });
    });

    // Sort theo date_order DESC
    result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return result;
  }, [orders, payoutMap, returnMap]);

  // Apply filters
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterType !== 'all' && r.orderType !== filterType) return false;
      if (filterPlatform !== 'all' && r.o.platform !== filterPlatform) return false;
      if (filterShopReceived === 'yes' && !r.shopReceived) return false;
      if (filterShopReceived === 'no' && r.shopReceived) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.orderId.toLowerCase().includes(q)
          && !r.productName.toLowerCase().includes(q)
          && !r.sku.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, filterType, filterPlatform, filterShopReceived, search]);

  // Toggle "Shop đã nhận" + save vào DB
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
      if (error) { alert('Lỗi: ' + error.message); return; }
      setReturns(prev => prev.map(r => r.order_id === orderId ? { ...r, shop_received: newVal } : r));
    } else {
      const { data, error } = await supabase
        .from('returns')
        .insert({ user_id: user.id, order_id: orderId, shop_received: newVal })
        .select().single();
      if (error) { alert('Lỗi: ' + error.message); return; }
      if (data) setReturns(prev => [...prev, data as Return]);
    }
  };

  // Update "Tình trạng hàng hoàn"
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
      if (error) { alert('Lỗi: ' + error.message); return; }
      setReturns(prev => prev.map(r => r.order_id === orderId ? { ...r, goods_condition: newCondition } : r));
    } else {
      const { data, error } = await supabase
        .from('returns')
        .insert({ user_id: user.id, order_id: orderId, goods_condition: newCondition })
        .select().single();
      if (error) { alert('Lỗi: ' + error.message); return; }
      if (data) setReturns(prev => [...prev, data as Return]);
    }
  };

  // Xuất Excel
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
      'Trạng thái THHT': r.refundStatus,
      'SL hoàn': r.returnedQty,
      'Loại': r.orderType,
      'Lý do hủy': r.cancelReason,
      'Sàn TT': r.shopeePayout,
      'Shop đã nhận': r.shopReceived ? 'Có' : 'Chưa',
      'Tình trạng hàng hoàn': r.goodsCondition,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trả hàng');
    XLSX.writeFile(wb, `tra-hang-${Date.now()}.xlsx`);
  };

  // KPI tổng
  const stats = useMemo(() => {
    let thht = 0, failedDelivery = 0, totalValue = 0, totalReceived = 0, totalUnreceived = 0;
    rows.forEach(r => {
      if (r.orderType === 'THHT') thht++; else failedDelivery++;
      totalValue += r.orderValue;
      if (r.shopReceived) totalReceived++; else totalUnreceived++;
    });
    return { thht, failedDelivery, totalValue, totalReceived, totalUnreceived };
  }, [rows]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">Đơn hủy / Trả hàng</h1>
      <p className="text-sm text-gray-500 mb-5">
        Theo dõi các đơn THHT (Trả hàng/Hoàn tiền) và đơn hủy do giao hàng thất bại
      </p>

      {/* KPI cards */}
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

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select className="input" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
          <option value="all">Tất cả loại</option>
          <option value="THHT">THHT</option>
          <option value="Giao hàng thất bại">Giao hàng thất bại</option>
        </select>
        <select className="input" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value as any)}>
          <option value="all">Tất cả sàn</option>
          <option value="shopee">Shopee</option>
          <option value="tiktok">TikTok</option>
        </select>
        <select className="input" value={filterShopReceived} onChange={e => setFilterShopReceived(e.target.value as any)}>
          <option value="all">Tất cả trạng thái nhận</option>
          <option value="yes">Đã nhận</option>
          <option value="no">Chưa nhận</option>
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-full" placeholder="Tìm mã đơn, SP, SKU..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={handleExport}>
          <Download size={15} /> Xuất Excel
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">Ngày đặt</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">Sàn</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">Mã đơn</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">Sản phẩm</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">SKU</th>
                <th className="text-right px-3 py-2 font-semibold text-xs text-gray-600">Giá bán</th>
                <th className="text-center px-3 py-2 font-semibold text-xs text-gray-600">SL</th>
                <th className="text-right px-3 py-2 font-semibold text-xs text-gray-600">Giá trị ĐH</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">TT THHT</th>
                <th className="text-center px-3 py-2 font-semibold text-xs text-gray-600">SL hoàn</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">Loại đơn</th>
                <th className="text-center px-3 py-2 font-semibold text-xs text-gray-600">Shop đã nhận</th>
                <th className="text-left px-3 py-2 font-semibold text-xs text-gray-600">Tình trạng hàng hoàn</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="text-center py-8 text-gray-400">Không có đơn nào</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.orderId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2">
                    <span className={`tag ${tagClass(r.platform === 'Shopee' ? 'shopee' : 'tiktok')}`}>
                      {r.platform}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.orderId}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={r.productName}>{r.productName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.price)}</td>
                  <td className="px-3 py-2 text-center">{r.quantity}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmt(r.orderValue)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.refundStatus && (
                      <span className="tag bg-red-100 text-red-700">{r.refundStatus}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">{r.returnedQty || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`tag ${r.orderType === 'THHT' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                      {r.orderType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
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
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      className="input input-sm w-full"
                      placeholder="Vd: Còn mới, Hỏng, Thiếu..."
                      defaultValue={r.goodsCondition}
                      onBlur={e => {
                        const newVal = e.target.value.trim();
                        if (newVal !== r.goodsCondition) updateCondition(r.orderId, newVal);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Hiển thị {filtered.length} đơn (lọc từ tổng {rows.length} đơn cần xử lý)
      </div>
    </div>
  );
}
