'use client';

import { useState, useMemo, useCallback } from 'react';
import { Order } from '@/lib/types';
import { fmt, fmtN, inRange } from '@/lib/utils';
import { buildCalcRows, Recon } from '@/lib/orderCalc';
import { Plus, Trash2 } from 'lucide-react';

type Props = {
  orders: Order[];
  products: { sku: string; cost?: number | null }[];
  reconciliation: Recon[];
};

type Platform = 'shopee' | 'tiktok';

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const pct = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

export default function ProfitClient({ orders, products, reconciliation }: Props) {
  // Tính sẵn dữ liệu tài chính từng đơn (giống trang Đơn hàng)
  const calcRows = useMemo(
    () => buildCalcRows(orders, products, reconciliation),
    [orders, products, reconciliation]
  );

  // Gộp doanh số / giá vốn / phí sàn thực tế theo (khoảng ngày, sàn)
  const aggregate = useCallback(
    (from: string, to: string, platform: Platform) => {
      let rev = 0, cogs = 0, fee = 0, count = 0;
      calcRows.forEach(r => {
        if (r.o.platform !== platform) return;
        if (r.isCancelled) return;
        if (from && to) {
          if (!inRange(r.o.date_order, 'custom', from, to)) return;
        } else if (from) {
          if (!inRange(r.o.date_order, 'custom', from, from)) return;
        } else if (to) {
          if (!inRange(r.o.date_order, 'custom', to, to)) return;
        }
        // Doanh số = giá trị đơn hàng (price_deal * qty - voucher)
        rev += r.orderValue;
        cogs += r.cogs;
        fee += platform === 'shopee' ? r.feeShopee : r.feeTikTok;
        if (r.isMainRow) count++;
      });
      return { rev, cogs, fee, count };
    },
    [calcRows]
  );

  return (
    <div className="fade-in max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Tính lỗ lãi</h1>
      <p className="text-sm text-gray-500 mb-6">
        Tổng hợp doanh số, chi phí và lợi nhuận theo khoảng thời gian và từng sàn
      </p>

      <ManualTable aggregate={aggregate} />
      <div className="h-8" />
      <AutoTable aggregate={aggregate} />
    </div>
  );
}

/* ============================================================
   BẢNG 1: TỔNG HỢP LỖ LÃI — phí sàn & quảng cáo nhập tay
   ============================================================ */
type ManualRow = {
  id: string;
  from: string;
  to: string;
  platform: Platform;
  fee: number;   // phí sàn nhập tay
  ads: number;   // quảng cáo nhập tay
};

function ManualTable({
  aggregate,
}: {
  aggregate: (f: string, t: string, p: Platform) => { rev: number; cogs: number; fee: number; count: number };
}) {
  const [rows, setRows] = useState<ManualRow[]>([
    { id: uid(), from: monthStart(), to: todayStr(), platform: 'shopee', fee: 0, ads: 0 },
  ]);

  const add = () =>
    setRows(r => [...r, { id: uid(), from: monthStart(), to: todayStr(), platform: 'shopee', fee: 0, ads: 0 }]);
  const update = (id: string, patch: Partial<ManualRow>) =>
    setRows(r => r.map(row => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => setRows(r => r.filter(row => row.id !== id));

  const computed = rows.map(row => {
    const { rev, cogs, count } = aggregate(row.from, row.to, row.platform);
    const fee = +row.fee || 0;
    const ads = +row.ads || 0;
    const profit = rev - cogs - fee - ads;
    return { ...row, rev, cogs, fee, ads, profit, count };
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">1. Tổng hợp lỗ lãi</h2>
          <p className="text-sm text-gray-500">Doanh số &amp; giá vốn từ đơn hàng. Phí sàn và quảng cáo tự nhập</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={add}>
          <Plus size={14} /> Thêm
        </button>
      </div>

      <div className="space-y-3">
        {computed.map(row => (
          <div key={row.id} className="card">
            <PeriodHeader
              from={row.from}
              to={row.to}
              platform={row.platform}
              count={row.count}
              onFrom={v => update(row.id, { from: v })}
              onTo={v => update(row.id, { to: v })}
              onPlatform={v => update(row.id, { platform: v })}
              onRemove={() => remove(row.id)}
            />
            <div className="divide-y divide-gray-100 text-sm">
              <Line label="Doanh số" value={fmt(row.rev)} />
              <Line label="Giá vốn hàng bán" value={fmt(row.cogs)} percent={pct(row.cogs, row.rev)} />
              <LineInput
                label="Phí sàn"
                value={row.fee}
                percent={pct(row.fee, row.rev)}
                onChange={v => update(row.id, { fee: v })}
              />
              <LineInput
                label="Quảng cáo"
                value={row.ads}
                percent={pct(row.ads, row.rev)}
                onChange={v => update(row.id, { ads: v })}
              />
              <ProfitLine profit={row.profit} rev={row.rev} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   BẢNG 2: THỐNG KÊ — phí sàn tự lấy từ dữ liệu đơn hàng
   ============================================================ */
type AutoRow = {
  id: string;
  from: string;
  to: string;
  platform: Platform;
  ads: number;   // quảng cáo vẫn nhập tay (đơn không có dữ liệu QC)
};

function AutoTable({
  aggregate,
}: {
  aggregate: (f: string, t: string, p: Platform) => { rev: number; cogs: number; fee: number; count: number };
}) {
  const [rows, setRows] = useState<AutoRow[]>([
    { id: uid(), from: monthStart(), to: todayStr(), platform: 'shopee', ads: 0 },
  ]);

  const add = () =>
    setRows(r => [...r, { id: uid(), from: monthStart(), to: todayStr(), platform: 'shopee', ads: 0 }]);
  const update = (id: string, patch: Partial<AutoRow>) =>
    setRows(r => r.map(row => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => setRows(r => r.filter(row => row.id !== id));

  const computed = rows.map(row => {
    const { rev, cogs, fee, count } = aggregate(row.from, row.to, row.platform);
    const ads = +row.ads || 0;
    const profit = rev - cogs - fee - ads;
    return { ...row, rev, cogs, fee, ads, profit, count };
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">2. Thống kê</h2>
          <p className="text-sm text-gray-500">Phí sàn tự lấy từ phí Shopee / phí TikTok của đơn hàng</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={add}>
          <Plus size={14} /> Thêm
        </button>
      </div>

      <div className="space-y-3">
        {computed.map(row => (
          <div key={row.id} className="card">
            <PeriodHeader
              from={row.from}
              to={row.to}
              platform={row.platform}
              count={row.count}
              onFrom={v => update(row.id, { from: v })}
              onTo={v => update(row.id, { to: v })}
              onPlatform={v => update(row.id, { platform: v })}
              onRemove={() => remove(row.id)}
            />
            <div className="divide-y divide-gray-100 text-sm">
              <Line label="Doanh số" value={fmt(row.rev)} />
              <Line label="Giá vốn hàng bán" value={fmt(row.cogs)} percent={pct(row.cogs, row.rev)} />
              <Line label="Phí sàn (tự động)" value={fmt(row.fee)} percent={pct(row.fee, row.rev)} />
              <LineInput
                label="Quảng cáo"
                value={row.ads}
                percent={pct(row.ads, row.rev)}
                onChange={v => update(row.id, { ads: v })}
              />
              <ProfitLine profit={row.profit} rev={row.rev} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Lợi nhuận = Doanh số − Giá vốn hàng bán − Phí sàn − Quảng cáo. % tính theo doanh số.
      </p>
    </section>
  );
}

/* ===================== Sub-components dùng chung ===================== */

function PeriodHeader({
  from, to, platform, count, onFrom, onTo, onPlatform, onRemove,
}: {
  from: string; to: string; platform: Platform; count: number;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  onPlatform: (v: Platform) => void; onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-gray-100">
      <input type="date" className="input !py-1 text-sm" value={from} onChange={e => onFrom(e.target.value)} />
      <span className="text-gray-400">→</span>
      <input type="date" className="input !py-1 text-sm" value={to} onChange={e => onTo(e.target.value)} />
      <select className="input !py-1 text-sm" value={platform} onChange={e => onPlatform(e.target.value as Platform)}>
        <option value="shopee">Shopee</option>
        <option value="tiktok">TikTok Shop</option>
      </select>
      <span className="text-xs text-gray-400 ml-auto">{fmtN(count)} đơn</span>
      <button className="text-gray-400 hover:text-red-600" onClick={onRemove} title="Xóa">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function Line({ label, value, percent }: { label: string; value: string; percent?: number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-medium tabular-nums">{value}</span>
        <span className="text-xs text-gray-400 w-14 text-right tabular-nums">
          {percent !== undefined ? percent.toFixed(1) + '%' : ''}
        </span>
      </div>
    </div>
  );
}

function LineInput({
  label, value, percent, onChange,
}: { label: string; value: number; percent: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="number"
          className="input !py-1 text-right w-32 text-sm"
          value={value || ''}
          placeholder="0"
          onChange={e => onChange(+e.target.value || 0)}
        />
        <span className="text-xs text-gray-400 w-14 text-right tabular-nums">{percent.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function ProfitLine({ profit, rev }: { profit: number; rev: number }) {
  const cls = profit >= 0 ? 'text-green-600' : 'text-red-600';
  return (
    <div className="flex items-center justify-between py-2 pt-3">
      <span className="font-semibold">Lợi nhuận</span>
      <div className="flex items-center gap-3">
        <span className={`font-bold tabular-nums ${cls}`}>{fmt(profit)}</span>
        <span className={`text-xs w-14 text-right tabular-nums ${cls}`}>
          {pct(profit, rev).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
