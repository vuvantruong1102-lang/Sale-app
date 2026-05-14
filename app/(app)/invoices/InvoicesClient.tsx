'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Invoice, Order } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtN, fmtDate, inRange, norm, findCol, parseDate, shortStatus, tagClass } from '@/lib/utils';
import { Upload, RefreshCw } from 'lucide-react';

type Props = {
  initialInvoices: Invoice[];
  orders: Order[];
  revRule: string;
};

export default function InvoicesClient({ initialInvoices, orders: ordersProp, revRule }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [orders, setOrders] = useState<Order[]>(ordersProp);
  const [range, setRange] = useState('30days');
  const [tab, setTab] = useState<'all' | 'missing'>('all');
  const [importing, setImporting] = useState(false);
  const [alert, setAlert] = useState<{ type: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredInv = useMemo(() => invoices.filter(i => inRange(i.invoice_date, range)), [invoices, range]);

  const orderIdsSet = useMemo(() => new Set(orders.map(o => o.order_id)), [orders]);

  const stats = useMemo(() => {
    let matched = 0, unmatched = 0, totalVal = 0;
    filteredInv.forEach(i => {
      totalVal += i.total_amount || 0;
      if (i.order_id && orderIdsSet.has(i.order_id)) matched++; else unmatched++;
    });
    return { matched, unmatched, totalVal };
  }, [filteredInv, orderIdsSet]);

  // Đơn chưa xuất HĐ
  const missing = useMemo(() => {
    const valid = orders.filter(o => {
      const s = norm(o.status);
      if (revRule === 'completed') return s.includes('đã giao') || s.includes('hoàn thành') || s.includes('người mua xác nhận');
      if (revRule === 'shipping') return !s.includes('đã hủy') && s !== '';
      return !s.includes('đã hủy');
    }).filter(o => !o.invoice_issued).filter(o => inRange(o.date_order, range));

    const m = new Map<string, { orderId: string; platform: string; items: string[]; total: number; date: any; status: string }>();
    valid.forEach(o => {
      const c = m.get(o.order_id) || {
        orderId: o.order_id, platform: o.platform, items: [], total: 0, date: o.date_order, status: o.status || '',
      };
      c.items.push(`${o.product_name} (${o.sku}) x${o.quantity}`);
      c.total += o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || 0;
      m.set(o.order_id, c);
    });
    return Array.from(m.values());
  }, [orders, revRule, range]);

  const missValue = missing.reduce((s, m) => s + m.total, 0);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImporting(true);
    setAlert(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      const payload: any[] = [];
      const ordersToUpdate: { order_id: string; invoice_no: string }[] = [];
      const toIso = (v: any) => { const d = parseDate(v); return d ? d.toISOString() : null; };

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sh, { defval: null, raw: false });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);
        const c_no = findCol(headers, 'Số HĐ', 'Số hóa đơn', 'Invoice No');
        const c_order = findCol(headers, 'Mã đơn hàng', 'Order ID', 'Mã đơn');
        const c_name = findCol(headers, 'Tên sản phẩm', 'Tên hàng hóa', 'Mặt hàng');
        const c_qty = findCol(headers, 'Số lượng', 'Quantity', 'SL');
        const c_price = findCol(headers, 'Đơn giá', 'Unit Price');
        const c_total = findCol(headers, 'Thành tiền', 'Total', 'Giá trị');
        const c_date = findCol(headers, 'Ngày xuất', 'Ngày HĐ', 'Invoice Date', 'Ngày');

        for (const r of rows) {
          const rec = {
            user_id: user.id,
            invoice_no: c_no ? String(r[c_no] ?? '').trim() : '',
            order_id: c_order ? String(r[c_order] ?? '').trim() : '',
            product_name: c_name ? String(r[c_name] ?? '').trim() : '',
            quantity: c_qty ? +r[c_qty] || 0 : 0,
            unit_price: c_price ? +r[c_price] || 0 : 0,
            total_amount: c_total ? +r[c_total] || 0 : 0,
            invoice_date: c_date ? toIso(r[c_date]) : null,
          };
          if (!rec.invoice_no && !rec.order_id) continue;
          payload.push(rec);
          if (rec.order_id) ordersToUpdate.push({ order_id: rec.order_id, invoice_no: rec.invoice_no });
        }
      }

      // Insert hóa đơn
      const BATCH = 500;
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase.from('invoices').insert(slice);
        if (error) throw error;
      }

      // Đánh dấu các đơn đã có HĐ
      let matched = 0;
      for (const u of ordersToUpdate) {
        const { error, count } = await supabase
          .from('orders')
          .update({ invoice_issued: true, invoice_no: u.invoice_no }, { count: 'exact' })
          .eq('order_id', u.order_id);
        if (!error && count) matched += count;
      }

      setAlert({ type: 'success', text: `✓ Đã import ${payload.length} dòng HĐ, đối chiếu khớp ${matched} đơn` });

      const [{ data: inv }, { data: ords }] = await Promise.all([
        supabase.from('invoices').select('*').order('invoice_date', { ascending: false }),
        supabase.from('orders').select('*').limit(20000),
      ]);
      setInvoices(inv || []);
      setOrders(ords || []);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const markInvoiced = async (orderId: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ invoice_issued: true })
      .eq('order_id', orderId);
    if (error) { window.alert(error.message); return; }
    const { data } = await supabase.from('orders').select('*').limit(20000);
    setOrders(data || []);
    router.refresh();
  };

  const reconcile = async () => {
    let matched = 0;
    for (const i of invoices) {
      if (!i.order_id) continue;
      const { count } = await supabase
        .from('orders')
        .update({ invoice_issued: true, invoice_no: i.invoice_no }, { count: 'exact' })
        .eq('order_id', i.order_id);
      if (count) matched++;
    }
    setAlert({ type: 'success', text: `✓ Đối chiếu: ${matched} HĐ khớp đơn` });
    const { data } = await supabase.from('orders').select('*').limit(20000);
    setOrders(data || []);
    router.refresh();
  };

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Hóa đơn điện tử</h1>
      <p className="text-sm text-gray-500 mb-5">Import HĐ đã xuất — đối chiếu với đơn hàng để phát hiện đơn còn sót chưa gửi cơ quan thuế</p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImport} />
        <button className="btn btn-primary" disabled={importing} onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {importing ? 'Đang import...' : 'Import file HĐ'}
        </button>
        <select className="input" value={range} onChange={e => setRange(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="7days">7 ngày qua</option>
          <option value="30days">30 ngày qua</option>
          <option value="month">Tháng này</option>
        </select>
        <button className="btn btn-secondary" onClick={reconcile}>
          <RefreshCw size={14} /> Đối chiếu lại
        </button>
      </div>

      {alert && (
        <div className={`mb-4 px-4 py-3 rounded-md text-sm ${
          alert.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          'bg-red-50 text-red-700 border border-red-200'
        }`}>{alert.text}</div>
      )}

      <div className="flex gap-1 border-b border-gray-200 mb-5">
        <button onClick={() => setTab('all')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            tab === 'all' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}>
          Hóa đơn đã xuất ({invoices.length})
        </button>
        <button onClick={() => setTab('missing')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            tab === 'missing' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}>
          Đơn chưa xuất HĐ ({missing.length})
        </button>
      </div>

      {tab === 'all' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <KPI title="Tổng số HĐ" value={fmtN(filteredInv.length)} />
            <KPI title="Tổng giá trị" value={fmt(stats.totalVal)} />
            <KPI title="Khớp đơn hàng" value={fmtN(stats.matched)} color="text-green-600" />
            <KPI title="Không khớp" value={fmtN(stats.unmatched)} color="text-red-600" />
          </div>

          <div className="card !p-0 overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th>Số HĐ</th><th>Mã đơn</th><th>Tên SP</th>
                <th className="text-right">SL</th><th className="text-right">Đơn giá</th>
                <th className="text-right">Thành tiền</th><th>Ngày xuất</th><th>Khớp</th>
              </tr></thead>
              <tbody>
                {filteredInv.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-gray-400 py-12">Chưa có HĐ — hãy import file</td></tr>
                )}
                {filteredInv.slice(0, 500).map((i, idx) => {
                  const ok = i.order_id && orderIdsSet.has(i.order_id);
                  return (
                    <tr key={idx}>
                      <td className="font-medium">{i.invoice_no || '-'}</td>
                      <td>{i.order_id || '-'}</td>
                      <td><div className="max-w-[260px] truncate" title={i.product_name}>{i.product_name || '-'}</div></td>
                      <td className="text-right">{i.quantity}</td>
                      <td className="text-right">{fmt(i.unit_price)}</td>
                      <td className="text-right font-medium">{fmt(i.total_amount)}</td>
                      <td className="text-xs">{fmtDate(i.invoice_date)}</td>
                      <td>{ok
                        ? <span className="tag bg-green-100 text-green-700">Khớp</span>
                        : <span className="tag bg-red-100 text-red-700">Không khớp</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'missing' && (
        <>
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-md text-sm mb-4">
            <strong>⚠ Đơn hàng chưa xuất hóa đơn</strong> — cần kiểm tra để xuất kịp gửi cơ quan thuế
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <KPI title="Đơn chưa xuất HĐ" value={fmtN(missing.length)} color="text-red-600" />
            <KPI title="Tổng giá trị" value={fmt(missValue)} />
          </div>

          <div className="card !p-0 overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th>Mã đơn</th><th>Sàn</th><th>Sản phẩm</th>
                <th className="text-right">SL items</th><th className="text-right">Thành tiền</th>
                <th>Ngày đặt</th><th>Trạng thái</th><th></th>
              </tr></thead>
              <tbody>
                {missing.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-gray-400 py-12">Tất cả đơn đã xuất hóa đơn 👍</td></tr>
                )}
                {missing.slice(0, 500).map(m => {
                  const st = shortStatus(m.status);
                  return (
                    <tr key={m.orderId}>
                      <td className="font-medium">{m.orderId}</td>
                      <td><span className={`tag ${tagClass(m.platform)}`}>{m.platform === 'shopee' ? 'Shopee' : 'TikTok'}</span></td>
                      <td><div className="max-w-[340px] truncate" title={m.items.join('; ')}>{m.items.join('; ')}</div></td>
                      <td className="text-right">{m.items.length}</td>
                      <td className="text-right font-medium">{fmt(m.total)}</td>
                      <td className="text-xs">{fmtDate(m.date)}</td>
                      <td><span className={`tag ${tagClass(st.color)}`}>{st.text}</span></td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => markInvoiced(m.orderId)}>
                          Đánh dấu đã xuất
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ title, value, color }: { title: string; value: string; color?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{title}</div>
      <div className={`text-2xl font-bold mt-1 ${color || ''}`}>{value}</div>
    </div>
  );
}
