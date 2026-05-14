'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Order } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, findCol, shortStatus, tagClass, parseDate } from '@/lib/utils';
import { Upload, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';

const PAGE_SIZE = 50;

type Props = {
  initialOrders: Order[];
  products: { sku: string; cost: number }[];
};

export default function OrdersClient({ initialOrders, products }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');
  const [invFilter, setInvFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [alert, setAlert] = useState<{ type: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Map SKU -> giá vốn để lookup nhanh
  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach(p => m.set(p.sku, p.cost || 0));
    return m;
  }, [products]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => set.add(shortStatus(o.status || '').text));
    return Array.from(set).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    const q = norm(search);
    let list = orders.slice();
    if (platform !== 'all') list = list.filter(o => o.platform === platform);
    if (status !== 'all') list = list.filter(o => shortStatus(o.status || '').text === status);
    if (invFilter === 'yes') list = list.filter(o => o.invoice_issued);
    else if (invFilter === 'no') list = list.filter(o => !o.invoice_issued);
    if (q) list = list.filter(o =>
      norm(o.order_id).includes(q) || norm(o.product_name).includes(q) || norm(o.sku).includes(q)
    );
    return list;
  }, [orders, platform, status, invFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

      // Lấy user_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Không xác thực được người dùng');

      // Lấy danh sách unique_key đã có để biết added vs updated
      const existingKeys = new Set(orders.map(o => o.unique_key));
      allRows.forEach(r => {
        if (existingKeys.has(r.unique_key)) updated++; else added++;
      });

      // Upsert batch 500 dòng / lần
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
      // Lấy SKU đã có
      const { data: existingProds } = await supabase.from('products').select('sku');
      const existingSkus = new Set((existingProds || []).map(p => p.sku));
      const newProducts = Array.from(skuMap.values())
        .filter(p => !existingSkus.has(p.sku))
        .map(p => ({ ...p, user_id: user.id, stock_initial: 0, cost: 0, price: 0, unit: 'cái' }));
      if (newProducts.length) {
        await supabase.from('products').upsert(newProducts, { onConflict: 'user_id,sku', ignoreDuplicates: true });
      }

      setAlert({ type: 'success', text: `✓ Đã import ${total} dòng — ${added} đơn mới, ${updated} đơn cập nhật${newProducts.length ? `, ${newProducts.length} SKU mới đồng bộ vào kho` : ''}` });

      // Reload danh sách orders
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

  const handleExport = () => {
    if (!filtered.length) { window.alert('Không có dữ liệu'); return; }
    const rows = filtered.map(o => {
      const price = (o.price_deal || 0) - (o.shop_voucher || 0);
      const totalFee = (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
      const cogs = (costMap.get(o.sku || '') || 0) * (o.quantity || 1);
      const profit = price * (o.quantity || 1) - totalFee - cogs;
      return {
        'Ngày đặt': o.date_order,
        'Sàn': o.platform,
        'Mã đơn': o.order_id,
        'ĐVVC': o.carrier,
        'Mã kiện': o.package_id,
        'Trạng thái': o.status,
        'Sản phẩm': o.product_name,
        'SKU': o.sku,
        'Số lượng': o.quantity,
        'Giá bán': price,
        'Tổng phí': totalFee,
        'Giá vốn HB': cogs,
        'Lợi nhuận': profit,
        'Đã xuất HĐ': o.invoice_issued ? 'Có' : 'Không',
      };
    });
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
        <select className="input" value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }}>
          <option value="all">Tất cả sàn</option>
          <option value="shopee">Shopee</option>
          <option value="tiktok">TikTok</option>
        </select>
        <select className="input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">Tất cả trạng thái</option>
          {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={invFilter} onChange={e => { setInvFilter(e.target.value); setPage(1); }}>
          <option value="all">Tất cả HĐ</option>
          <option value="yes">Đã xuất HĐ</option>
          <option value="no">Chưa xuất HĐ</option>
        </select>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-64" placeholder="Tìm mã đơn, SP, SKU..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={14} /> Xuất Excel
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
        <table className="tbl orders-tbl">
          <thead><tr>
            <th style={{ width: 130 }}>Ngày đặt</th>
            <th style={{ width: 80 }}>Sàn</th>
            <th style={{ width: 140 }}>Mã đơn</th>
            <th style={{ width: 120 }}>ĐVVC</th>
            <th style={{ width: 110 }}>Mã kiện</th>
            <th style={{ width: 110 }}>Trạng thái</th>
            <th style={{ minWidth: 260 }}>Sản phẩm</th>
            <th style={{ width: 100 }}>SKU</th>
            <th style={{ width: 110 }} className="text-right">Giá bán</th>
            <th style={{ width: 100 }} className="text-right">Tổng phí</th>
            <th style={{ width: 110 }} className="text-right">Giá vốn HB</th>
            <th style={{ width: 110 }} className="text-right">Lợi nhuận</th>
            <th style={{ width: 70 }}>HĐ</th>
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={13} className="text-center text-gray-400 py-12">
                {orders.length === 0 ? 'Chưa có đơn hàng — hãy import file Shopee' : 'Không có đơn khớp bộ lọc'}
              </td></tr>
            )}
            {pageRows.map(o => {
              const st = shortStatus(o.status || '');
              // Giá bán = Giá ưu đãi - Mã giảm giá Shop
              const price = (o.price_deal || 0) - (o.shop_voucher || 0);
              // Tổng phí
              const totalFee = (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
              // Giá vốn HB = giá vốn SKU × số lượng
              const cogs = (costMap.get(o.sku || '') || 0) * (o.quantity || 1);
              // Lợi nhuận = Giá bán × SL - Tổng phí - Giá vốn HB
              const profit = price * (o.quantity || 1) - totalFee - cogs;
              return (
                <tr key={o.unique_key}>
                  <td className="text-xs whitespace-nowrap">{fmtDate(o.date_order)}</td>
                  <td><span className={`tag ${tagClass(o.platform)}`}>{o.platform === 'shopee' ? 'Shopee' : 'TikTok'}</span></td>
                  <td className="font-medium whitespace-nowrap">{o.order_id}</td>
                  <td className="text-xs">{o.carrier || '-'}</td>
                  <td className="text-xs">{o.package_id || '-'}</td>
                  <td><span className={`tag ${tagClass(st.color)}`}>{st.text}</span></td>
                  <td>
                    <div className="truncate" title={o.product_name} style={{ maxWidth: 260 }}>{o.product_name || '-'}</div>
                    {o.quantity && o.quantity > 1 && <span className="text-xs text-gray-400">×{o.quantity}</span>}
                  </td>
                  <td className="text-xs">{o.sku || '-'}</td>
                  <td className="text-right">{fmt(price)}</td>
                  <td className="text-right text-yellow-600">{fmt(totalFee)}</td>
                  <td className="text-right">{cogs > 0 ? fmt(cogs) : <span className="text-gray-300">—</span>}</td>
                  <td className={`text-right font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {cogs > 0 ? fmt(profit) : <span className="text-gray-300">—</span>}
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
        <div className="text-sm text-gray-500">{filtered.length.toLocaleString('vi-VN')} đơn</div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}>
            <ChevronLeft size={14} /> Trước
          </button>
          <span className="text-sm text-gray-500">Trang {page}/{totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Sau <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
