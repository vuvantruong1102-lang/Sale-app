'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Order } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, findCol, shortStatus, tagClass, parseDate } from '@/lib/utils';
import { Upload, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';

const PAGE_SIZE = 50;

export default function OrdersClient({ initialOrders }: { initialOrders: Order[] }) {
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
    const rows = filtered.map(o => ({
      'Mã đơn': o.order_id, 'Sàn': o.platform, 'Trạng thái': o.status,
      'Sản phẩm': o.product_name, 'SKU': o.sku, 'Giá': o.price_deal,
      'Số lượng': o.quantity, 'Phí cố định': o.fee_fix, 'Phí DV': o.fee_service,
      'Phí TT': o.fee_payment, 'Mã giảm Shop': o.shop_voucher, 'ĐVVC': o.carrier,
      'Mã kiện': o.package_id, 'Ngày đặt': o.date_order, 'Ngày gửi': o.date_ship,
      'Đã xuất HĐ': o.invoice_issued ? 'Có' : 'Không',
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
        <table className="tbl">
          <thead><tr>
            <th>Mã đơn</th><th>Sàn</th><th>Trạng thái</th><th>Sản phẩm</th><th>SKU</th>
            <th className="text-right">Giá</th><th className="text-right">SL</th>
            <th className="text-right">Phí cố định</th><th className="text-right">Phí DV</th>
            <th className="text-right">Phí TT</th><th>Mã giảm Shop</th><th>ĐVVC</th>
            <th>Mã kiện</th><th>Đặt hàng</th><th>HĐ</th>
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={15} className="text-center text-gray-400 py-12">
                {orders.length === 0 ? 'Chưa có đơn hàng — hãy import file Shopee' : 'Không có đơn khớp bộ lọc'}
              </td></tr>
            )}
            {pageRows.map(o => {
              const st = shortStatus(o.status || '');
              return (
                <tr key={o.unique_key}>
                  <td className="font-medium">{o.order_id}</td>
                  <td><span className={`tag ${tagClass(o.platform)}`}>{o.platform === 'shopee' ? 'Shopee' : 'TikTok'}</span></td>
                  <td><span className={`tag ${tagClass(st.color)}`}>{st.text}</span></td>
                  <td><div className="max-w-[240px] truncate" title={o.product_name}>{o.product_name || '-'}</div></td>
                  <td>{o.sku || '-'}</td>
                  <td className="text-right">{fmt(o.price_deal || o.price_original)}</td>
                  <td className="text-right">{o.quantity}</td>
                  <td className="text-right">{fmt(o.fee_fix)}</td>
                  <td className="text-right">{fmt(o.fee_service)}</td>
                  <td className="text-right">{fmt(o.fee_payment)}</td>
                  <td>{fmt(o.shop_voucher)}</td>
                  <td>{o.carrier || '-'}</td>
                  <td className="text-xs">{o.package_id || '-'}</td>
                  <td className="text-xs">{fmtDate(o.date_order)}</td>
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
