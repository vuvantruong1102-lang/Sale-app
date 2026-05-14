'use client';

import { useState, useMemo } from 'react';
import { Order, Ad, Product } from '@/lib/types';
import { fmt, fmtN, dateKey, inRange, norm, parseDate } from '@/lib/utils';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, ArcElement,
} from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, ArcElement
);

type Props = {
  initialOrders: Order[];
  initialAds: Ad[];
  initialProducts: Product[];
  revRule: string;
};

export default function DashboardClient({ initialOrders, initialAds, initialProducts, revRule }: Props) {
  const [range, setRange] = useState('30days');
  const [platform, setPlatform] = useState('all');
  const [chartGroup, setChartGroup] = useState<'day' | 'month' | 'year'>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(() => {
    // Filter theo revenue rule
    let list = initialOrders.filter(o => {
      const s = norm(o.status);
      if (revRule === 'completed') return s.includes('đã giao') || s.includes('hoàn thành') || s.includes('người mua xác nhận');
      if (revRule === 'shipping') return !s.includes('đã hủy') && s !== '';
      return !s.includes('đã hủy');
    });
    if (platform !== 'all') list = list.filter(o => o.platform === platform);
    list = list.filter(o => inRange(o.date_order, range, from, to));
    return list;
  }, [initialOrders, revRule, platform, range, from, to]);

  const stats = useMemo(() => {
    let rev = 0, fee = 0, cogs = 0;
    const orderIds = new Set<string>();
    filtered.forEach(o => {
      const r = o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || o.total_order_value || 0;
      rev += r;
      fee += (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
      orderIds.add(o.order_id);
      const p = initialProducts.find(x => x.sku === o.sku);
      if (p) cogs += (p.cost || 0) * (o.quantity || 1);
    });
    let adsCost = 0;
    initialAds.filter(a => inRange(a.date, range, from, to)).forEach(a => adsCost += a.cost || 0);
    const profit = rev - fee - adsCost - cogs;
    return { rev, fee, cogs, adsCost, profit, orderCount: orderIds.size };
  }, [filtered, initialAds, initialProducts, range, from, to]);

  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(o => {
      const k = dateKey(o.date_order, chartGroup);
      if (!k) return;
      const r = o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || 0;
      map.set(k, (map.get(k) || 0) + r);
    });
    const keys = Array.from(map.keys()).sort();
    return {
      labels: keys,
      datasets: [{
        label: 'Doanh thu (VND)',
        data: keys.map(k => map.get(k)!),
        borderColor: '#ee4d2d',
        backgroundColor: 'rgba(238,77,45,0.08)',
        fill: true, tension: 0.35, pointRadius: 3,
      }],
    };
  }, [filtered, chartGroup]);

  const topProducts = useMemo(() => {
    const m = new Map<string, { sku: string; name: string; qty: number; rev: number }>();
    filtered.forEach(o => {
      const k = o.sku || '';
      if (!k) return;
      const cur = m.get(k) || { sku: k, name: o.product_name || '', qty: 0, rev: 0 };
      cur.qty += o.quantity || 1;
      cur.rev += o.total_paid || ((o.price_deal || 0) * (o.quantity || 1)) || 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.rev - a.rev).slice(0, 15);
  }, [filtered]);

  const statusData = useMemo(() => {
    let list = initialOrders;
    if (platform !== 'all') list = list.filter(o => o.platform === platform);
    list = list.filter(o => inRange(o.date_order, range, from, to));
    const map = new Map<string, number>();
    list.forEach(o => {
      let s = norm(o.status);
      let key: string;
      if (s.includes('đã hủy')) key = 'Đã hủy';
      else if (s.includes('đang giao')) key = 'Đang giao';
      else if (s.includes('chờ giao')) key = 'Chờ giao';
      else if (s.includes('người mua xác nhận')) key = 'Đã nhận';
      else if (s.includes('đã giao')) key = 'Đã giao';
      else if (s.includes('hoàn thành')) key = 'Hoàn thành';
      else key = o.status || 'Khác';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return {
      labels: Array.from(map.keys()),
      datasets: [{
        data: Array.from(map.values()),
        backgroundColor: ['#22c55e', '#3b82f6', '#eab308', '#ee4d2d', '#ef4444', '#a855f7', '#94a3b8', '#06b6d4'],
        borderWidth: 0,
      }],
    };
  }, [initialOrders, platform, range, from, to]);

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Tổng quan kinh doanh</h1>
      <p className="text-sm text-gray-500 mb-6">Doanh thu, chi phí và lợi nhuận theo thời gian thực</p>

      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <label className="text-sm text-gray-600">Khoảng thời gian:</label>
        <select className="input" value={range} onChange={e => setRange(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="today">Hôm nay</option>
          <option value="7days">7 ngày qua</option>
          <option value="30days">30 ngày qua</option>
          <option value="month">Tháng này</option>
          <option value="year">Năm này</option>
          <option value="custom">Tùy chọn</option>
        </select>
        {range === 'custom' && (
          <>
            <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
            <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </>
        )}
        <label className="text-sm text-gray-600 ml-2">Sàn:</label>
        <select className="input" value={platform} onChange={e => setPlatform(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="shopee">Shopee</option>
          <option value="tiktok">TikTok Shop</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <KPI title="Doanh thu" value={fmt(stats.rev)} sub={`${stats.orderCount} đơn`} color="text-gray-900" />
        <KPI title="Phí sàn" value={fmt(stats.fee)} sub={stats.rev ? `${(stats.fee / stats.rev * 100).toFixed(1)}% doanh thu` : '-'} color="text-yellow-600" />
        <KPI title="Phí quảng cáo" value={fmt(stats.adsCost)} sub={stats.rev ? `${(stats.adsCost / stats.rev * 100).toFixed(1)}% doanh thu` : '-'} color="text-blue-600" />
        <KPI title="Lợi nhuận" value={fmt(stats.profit)} sub={`Tỉ suất ${stats.rev ? (stats.profit / stats.rev * 100).toFixed(1) : '0'}%`} color={stats.profit >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="card mb-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Biểu đồ doanh thu</h3>
          <select className="input btn-sm" value={chartGroup} onChange={e => setChartGroup(e.target.value as any)}>
            <option value="day">Theo ngày</option>
            <option value="month">Theo tháng</option>
            <option value="year">Theo năm</option>
          </select>
        </div>
        <div style={{ height: 300 }}>
          <Line data={chartData} options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { ticks: { callback: (v: any) => (v / 1e6).toFixed(1) + 'M' } },
            },
          }} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold mb-4">Sản phẩm bán chạy</h3>
          <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
            <table className="tbl">
              <thead><tr>
                <th>#</th><th>Sản phẩm</th>
                <th className="text-right">SL</th><th className="text-right">Doanh thu</th>
              </tr></thead>
              <tbody>
                {topProducts.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-gray-400 py-10">Chưa có dữ liệu</td></tr>
                )}
                {topProducts.map((p, i) => (
                  <tr key={p.sku}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="max-w-md truncate" title={p.name}>{p.name}</div>
                      <div className="text-xs text-gray-400">{p.sku}</div>
                    </td>
                    <td className="text-right">{fmtN(p.qty)}</td>
                    <td className="text-right font-medium">{fmt(p.rev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-4">Trạng thái đơn hàng</h3>
          <div style={{ height: 280 }}>
            <Doughnut data={statusData} options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } } },
            }} />
          </div>
        </div>
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
