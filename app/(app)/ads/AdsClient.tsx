'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Ad } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtN, inRange, norm, findCol, parseDate } from '@/lib/utils';
import { Upload, Search } from 'lucide-react';

export default function AdsClient({ initialAds }: { initialAds: Ad[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [ads, setAds] = useState<Ad[]>(initialAds);
  const [range, setRange] = useState('30days');
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [alert, setAlert] = useState<{ type: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = ads.filter(a => inRange(a.date, range));
    const q = norm(search);
    if (q) list = list.filter(a => norm(a.sku).includes(q) || norm(a.product_name).includes(q));
    return list;
  }, [ads, range, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, { sku: string; name: string; cost: number; orders: number; revenue: number }>();
    filtered.forEach(a => {
      const k = a.sku || a.product_name || '';
      if (!k) return;
      const cur = m.get(k) || { sku: a.sku || '', name: a.product_name || '', cost: 0, orders: 0, revenue: 0 };
      cur.cost += a.cost || 0;
      cur.orders += a.orders_count || 0;
      cur.revenue += a.revenue || 0;
      if (a.product_name && !cur.name) cur.name = a.product_name;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
  }, [filtered]);

  const stats = useMemo(() => {
    let cost = 0, orders = 0, rev = 0;
    filtered.forEach(a => { cost += a.cost || 0; orders += a.orders_count || 0; rev += a.revenue || 0; });
    return { cost, orders, rev, roas: cost ? rev / cost : 0 };
  }, [filtered]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImporting(true);
    setAlert(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      const payload: any[] = [];
      const toIso = (v: any) => { const d = parseDate(v); return d ? d.toISOString() : null; };

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sh, { defval: null, raw: false });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);
        const c_sku = findCol(headers, 'SKU phân loại', 'Seller SKU', 'SKU', 'Mã SKU');
        const c_name = findCol(headers, 'Tên sản phẩm', 'Product Name');
        const c_date = findCol(headers, 'Ngày', 'Date', 'Thời gian');
        const c_cost = findCol(headers, 'Chi phí', 'Cost', 'Phí quảng cáo', 'Ad Spend');
        const c_orders = findCol(headers, 'Đơn hàng', 'Orders', 'Số đơn');
        const c_rev = findCol(headers, 'Doanh thu', 'Revenue', 'GMV');
        for (const r of rows) {
          const rec = {
            user_id: user.id,
            sku: c_sku ? String(r[c_sku] ?? '').trim() : '',
            product_name: c_name ? String(r[c_name] ?? '').trim() : '',
            date: c_date ? toIso(r[c_date]) : null,
            cost: c_cost ? +r[c_cost] || 0 : 0,
            orders_count: c_orders ? +r[c_orders] || 0 : 0,
            revenue: c_rev ? +r[c_rev] || 0 : 0,
          };
          if (!rec.sku && !rec.product_name) continue;
          payload.push(rec);
        }
      }

      const BATCH = 500;
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase.from('ads').insert(slice);
        if (error) throw error;
      }

      setAlert({ type: 'success', text: `✓ Đã import ${payload.length} dòng QC` });
      const { data } = await supabase.from('ads').select('*').order('date', { ascending: false });
      setAds(data || []);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Quảng cáo</h1>
      <p className="text-sm text-gray-500 mb-5">Import file dữ liệu QC hàng ngày — theo dõi ROAS theo từng SKU</p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImport} />
        <button className="btn btn-primary" disabled={importing} onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {importing ? 'Đang import...' : 'Import file QC'}
        </button>
        <select className="input" value={range} onChange={e => setRange(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="7days">7 ngày qua</option>
          <option value="30days">30 ngày qua</option>
          <option value="month">Tháng này</option>
        </select>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-64" placeholder="Tìm SKU, tên SP..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {alert && (
        <div className={`mb-4 px-4 py-3 rounded-md text-sm ${
          alert.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          'bg-red-50 text-red-700 border border-red-200'
        }`}>{alert.text}</div>
      )}

      <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-700">
        <strong>💡 Hướng dẫn:</strong> File QC cần có cột: <code>SKU</code> / <code>Tên sản phẩm</code>, <code>Ngày</code>, <code>Chi phí</code>, <code>Đơn hàng</code>, <code>Doanh thu</code>. Phần mềm sẽ tự nhận theo tên cột tương tự.
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KPI title="Tổng chi phí QC" value={fmt(stats.cost)} color="text-blue-600" />
        <KPI title="Đơn từ QC" value={fmtN(stats.orders)} />
        <KPI title="Doanh thu QC" value={fmt(stats.rev)} />
        <KPI title="ROAS" value={stats.roas.toFixed(2) + 'x'} sub="Doanh thu / Chi phí" />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="tbl">
          <thead><tr>
            <th>SKU / SP</th>
            <th className="text-right">Chi phí QC</th>
            <th className="text-right">Đơn từ QC</th>
            <th className="text-right">Doanh thu QC</th>
            <th className="text-right">CPA</th>
            <th className="text-right">ROAS</th>
          </tr></thead>
          <tbody>
            {grouped.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">
                Chưa có dữ liệu QC — hãy import file
              </td></tr>
            )}
            {grouped.map((a, i) => (
              <tr key={i}>
                <td>
                  <div className="font-medium">{a.sku || '-'}</div>
                  <div className="text-xs text-gray-400 max-w-[300px] truncate">{a.name}</div>
                </td>
                <td className="text-right">{fmt(a.cost)}</td>
                <td className="text-right">{fmtN(a.orders)}</td>
                <td className="text-right">{fmt(a.revenue)}</td>
                <td className="text-right">{a.orders ? fmt(a.cost / a.orders) : '-'}</td>
                <td className="text-right font-medium">{a.cost ? (a.revenue / a.cost).toFixed(2) + 'x' : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ title, value, sub, color }: { title: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{title}</div>
      <div className={`text-2xl font-bold mt-1 ${color || ''}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
