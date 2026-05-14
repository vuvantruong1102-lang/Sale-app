'use client';

import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Order, Ad, Product } from '@/lib/types';
import { fmt, fmtN, norm, dateKey, inRange } from '@/lib/utils';
import { Download } from 'lucide-react';

type Props = {
  orders: Order[];
  ads: Ad[];
  products: Product[];
  revRule: string;
};

export default function ProfitClient({ orders, ads, products, revRule }: Props) {
  const [group, setGroup] = useState<'day' | 'month' | 'year' | 'product'>('month');
  const [range, setRange] = useState('month');

  const validOrders = useMemo(() => orders.filter(o => {
    const s = norm(o.status);
    if (revRule === 'completed') return s.includes('đã giao') || s.includes('hoàn thành') || s.includes('người mua xác nhận');
    if (revRule === 'shipping') return !s.includes('đã hủy') && s !== '';
    return !s.includes('đã hủy');
  }).filter(o => inRange(o.date_order, range)), [orders, revRule, range]);

  const validAds = useMemo(() => ads.filter(a => inRange(a.date, range)), [ads, range]);

  const stats = useMemo(() => {
    let rev = 0, fee = 0, cogs = 0;
    validOrders.forEach(o => {
      rev += o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || 0;
      fee += (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
      const p = products.find(x => x.sku === o.sku);
      if (p) cogs += (p.cost || 0) * (o.quantity || 1);
    });
    let adsCost = 0; validAds.forEach(a => adsCost += a.cost || 0);
    const cost = fee + adsCost;
    const profit = rev - cost - cogs;
    return { rev, fee, cogs, adsCost, cost, profit };
  }, [validOrders, validAds, products]);

  const rows = useMemo(() => {
    if (group === 'product') {
      const m = new Map<string, any>();
      validOrders.forEach(o => {
        const k = o.sku || '';
        const c = m.get(k) || { sku: k, name: o.product_name, qty: 0, rev: 0, fee: 0, cogs: 0, ads: 0 };
        c.qty += o.quantity || 1;
        c.rev += o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || 0;
        c.fee += (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
        const p = products.find(x => x.sku === k);
        if (p) c.cogs += (p.cost || 0) * (o.quantity || 1);
        m.set(k, c);
      });
      validAds.forEach(a => {
        if (!a.sku) return;
        const c = m.get(a.sku);
        if (c) c.ads += a.cost || 0;
      });
      return Array.from(m.values()).map(c => ({
        ...c,
        profit: c.rev - c.fee - c.cogs - c.ads,
        margin: c.rev ? ((c.rev - c.fee - c.cogs - c.ads) / c.rev * 100) : 0,
      })).sort((a, b) => b.profit - a.profit);
    } else {
      const m = new Map<string, any>();
      validOrders.forEach(o => {
        const k = dateKey(o.date_order, group as any);
        if (!k) return;
        const c = m.get(k) || { key: k, orderIds: new Set(), rev: 0, fee: 0, cogs: 0, ads: 0 };
        c.orderIds.add(o.order_id);
        c.rev += o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || 0;
        c.fee += (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
        const p = products.find(x => x.sku === o.sku);
        if (p) c.cogs += (p.cost || 0) * (o.quantity || 1);
        m.set(k, c);
      });
      validAds.forEach(a => {
        const k = dateKey(a.date, group as any);
        if (!k) return;
        let c = m.get(k);
        if (!c) { c = { key: k, orderIds: new Set(), rev: 0, fee: 0, cogs: 0, ads: 0 }; m.set(k, c); }
        c.ads += a.cost || 0;
      });
      return Array.from(m.values()).map(c => ({
        ...c, orderCount: c.orderIds.size,
        profit: c.rev - c.fee - c.cogs - c.ads,
        margin: c.rev ? ((c.rev - c.fee - c.cogs - c.ads) / c.rev * 100) : 0,
      })).sort((a, b) => b.key.localeCompare(a.key));
    }
  }, [group, validOrders, validAds, products]);

  const handleExport = () => {
    const data = group === 'product'
      ? rows.map((r: any) => ({
          'SKU': r.sku, 'Tên SP': r.name, 'SL bán': r.qty,
          'Doanh thu': r.rev, 'Giá vốn': r.cogs, 'Phí sàn': r.fee, 'Phí QC': r.ads,
          'Lợi nhuận': r.profit, 'Tỉ suất': r.margin.toFixed(1) + '%',
        }))
      : rows.map((r: any) => ({
          'Kỳ': r.key, 'SL đơn': r.orderCount,
          'Doanh thu': r.rev, 'Giá vốn': r.cogs, 'Phí sàn': r.fee, 'Phí QC': r.ads,
          'Lợi nhuận': r.profit, 'Tỉ suất': r.margin.toFixed(1) + '%',
        }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lỗ lãi');
    XLSX.writeFile(wb, 'lo-lai-' + Date.now() + '.xlsx');
  };

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Tính lỗ lãi</h1>
      <p className="text-sm text-gray-500 mb-5">Tổng hợp doanh thu - chi phí - lợi nhuận theo thời gian và từng mặt hàng</p>

      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <label className="text-sm text-gray-600">Xem theo:</label>
        <select className="input" value={group} onChange={e => setGroup(e.target.value as any)}>
          <option value="day">Ngày</option>
          <option value="month">Tháng</option>
          <option value="year">Năm</option>
          <option value="product">Mặt hàng (SKU)</option>
        </select>
        <select className="input" value={range} onChange={e => setRange(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="30days">30 ngày qua</option>
          <option value="month">Tháng này</option>
          <option value="year">Năm này</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={14} /> Xuất Excel
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KPI title="Doanh thu" value={fmt(stats.rev)} />
        <KPI title="Giá vốn" value={fmt(stats.cogs)} color="text-yellow-600" />
        <KPI title="Tổng chi phí" value={fmt(stats.cost)} sub={`Sàn ${fmt(stats.fee)} • QC ${fmt(stats.adsCost)}`} color="text-red-600" />
        <KPI title="Lợi nhuận" value={fmt(stats.profit)} sub={`${stats.rev ? (stats.profit / stats.rev * 100).toFixed(1) : '0'}%`} color={stats.profit >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="tbl">
          <thead>
            {group === 'product' ? (
              <tr>
                <th>SKU</th><th>Tên SP</th>
                <th className="text-right">SL bán</th>
                <th className="text-right">Doanh thu</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Phí sàn</th>
                <th className="text-right">Phí QC</th>
                <th className="text-right">Lợi nhuận</th>
                <th className="text-right">Tỉ suất</th>
              </tr>
            ) : (
              <tr>
                <th>Kỳ</th>
                <th className="text-right">SL đơn</th>
                <th className="text-right">Doanh thu</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Phí sàn</th>
                <th className="text-right">Phí QC</th>
                <th className="text-right">Lợi nhuận</th>
                <th className="text-right">Tỉ suất</th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-gray-400 py-12">Chưa có dữ liệu</td></tr>
            )}
            {rows.map((r: any, i) => {
              const cls = r.profit >= 0 ? 'text-green-600' : 'text-red-600';
              return group === 'product' ? (
                <tr key={i}>
                  <td className="font-medium">{r.sku}</td>
                  <td><div className="max-w-[280px] truncate" title={r.name}>{r.name}</div></td>
                  <td className="text-right">{fmtN(r.qty)}</td>
                  <td className="text-right">{fmt(r.rev)}</td>
                  <td className="text-right">{fmt(r.cogs)}</td>
                  <td className="text-right">{fmt(r.fee)}</td>
                  <td className="text-right">{fmt(r.ads)}</td>
                  <td className={`text-right font-bold ${cls}`}>{fmt(r.profit)}</td>
                  <td className={`text-right ${cls}`}>{r.margin.toFixed(1)}%</td>
                </tr>
              ) : (
                <tr key={i}>
                  <td className="font-medium">{r.key}</td>
                  <td className="text-right">{r.orderCount}</td>
                  <td className="text-right">{fmt(r.rev)}</td>
                  <td className="text-right">{fmt(r.cogs)}</td>
                  <td className="text-right">{fmt(r.fee)}</td>
                  <td className="text-right">{fmt(r.ads)}</td>
                  <td className={`text-right font-bold ${cls}`}>{fmt(r.profit)}</td>
                  <td className={`text-right ${cls}`}>{r.margin.toFixed(1)}%</td>
                </tr>
              );
            })}
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
