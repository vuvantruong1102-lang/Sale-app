'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Order, Product, AdSpend } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, norm, parseDate } from '@/lib/utils';
import { Plus, Trash2, Save } from 'lucide-react';

type Props = {
  orders: Order[];
  adSpend: AdSpend[];
  products: Product[];
};

type Platform = 'shopee' | 'tiktok';

type ProfitRow = {
  id: string;
  from: string;
  to: string;
  platform: Platform;
  fee: number;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isCanceled = (status?: string) => {
  const s = norm(status);
  return s.includes('đã hủy') || s.includes('huy') || s.includes('cancel');
};

const orderRevenue = (o: Order) =>
  o.total_paid || (o.price_deal || 0) * (o.quantity || 1) || 0;

export default function ProfitClient({ orders, adSpend, products }: Props) {
  const supabase = createClient();

  // ---------------- BẢNG 1: Quảng cáo nhập tay ----------------
  type AdDayRow = { date: string; shopee: number; tiktok: number };

  const initialAdRows: AdDayRow[] = useMemo(() => {
    const m = new Map<string, AdDayRow>();
    adSpend.forEach(a => {
      const k = a.date;
      if (!k) return;
      const cur = m.get(k) || { date: k, shopee: 0, tiktok: 0 };
      if (a.platform === 'tiktok') cur.tiktok = a.cost || 0;
      else cur.shopee = a.cost || 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [adSpend]);

  const [adRows, setAdRows] = useState<AdDayRow[]>(initialAdRows);
  const [savingAds, setSavingAds] = useState(false);
  const [adAlert, setAdAlert] = useState<string | null>(null);

  useEffect(() => { setAdRows(initialAdRows); }, [initialAdRows]);

  const addAdRow = () =>
    setAdRows(r => [{ date: todayStr(), shopee: 0, tiktok: 0 }, ...r]);

  const updateAdRow = (i: number, patch: Partial<AdDayRow>) =>
    setAdRows(r => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const removeAdRow = (i: number) =>
    setAdRows(r => r.filter((_, idx) => idx !== i));

  const saveAds = async () => {
    setSavingAds(true);
    setAdAlert(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      const payload: any[] = [];
      adRows.forEach(row => {
        if (!row.date) return;
        payload.push({ user_id: user.id, date: row.date, platform: 'shopee', cost: +row.shopee || 0 });
        payload.push({ user_id: user.id, date: row.date, platform: 'tiktok', cost: +row.tiktok || 0 });
      });

      const { error } = await supabase
        .from('ad_spend')
        .upsert(payload, { onConflict: 'user_id,date,platform' });
      if (error) throw error;

      setAdAlert('✓ Đã lưu chi phí quảng cáo');
    } catch (err: any) {
      setAdAlert('Lỗi: ' + (err.message || err));
    } finally {
      setSavingAds(false);
    }
  };

  const adsInRange = useCallback(
    (from: string, to: string, platform: Platform): number => {
      if (!from || !to) return 0;
      let sum = 0;
      adRows.forEach(row => {
        if (row.date >= from && row.date <= to) {
          sum += platform === 'shopee' ? (+row.shopee || 0) : (+row.tiktok || 0);
        }
      });
      return sum;
    },
    [adRows]
  );

  // ---------------- BẢNG 2: Tổng hợp lỗ lãi ----------------
  const [profitRows, setProfitRows] = useState<ProfitRow[]>([
    { id: uid(), from: '', to: '', platform: 'shopee', fee: 0 },
  ]);

  const addProfitRow = () =>
    setProfitRows(r => [...r, { id: uid(), from: '', to: '', platform: 'shopee', fee: 0 }]);

  const updateProfitRow = (id: string, patch: Partial<ProfitRow>) =>
    setProfitRows(r => r.map(row => (row.id === id ? { ...row, ...patch } : row)));

  const removeProfitRow = (id: string) =>
    setProfitRows(r => r.filter(row => row.id !== id));

  const calcSales = useCallback(
    (from: string, to: string, platform: Platform) => {
      let rev = 0, cogs = 0;
      const fromD = from ? new Date(from + 'T00:00:00') : null;
      const toD = to ? new Date(to + 'T23:59:59') : null;
      orders.forEach(o => {
        if (o.platform !== platform) return;
        if (isCanceled(o.status)) return;
        const d = parseDate(o.date_order);
        if (!d) return;
        if (fromD && d < fromD) return;
        if (toD && d > toD) return;
        rev += orderRevenue(o);
        const p = products.find(x => x.sku === o.sku);
        if (p) cogs += (p.cost || 0) * (o.quantity || 1);
      });
      return { rev, cogs };
    },
    [orders, products]
  );

  const computedRows = useMemo(
    () =>
      profitRows.map(row => {
        const { rev, cogs } = calcSales(row.from, row.to, row.platform);
        const ads = adsInRange(row.from, row.to, row.platform);
        const fee = +row.fee || 0;
        const profit = rev - cogs - fee - ads;
        return { ...row, rev, cogs, ads, fee, profit };
      }),
    [profitRows, calcSales, adsInRange]
  );

  const totals = useMemo(() => {
    return computedRows.reduce(
      (acc, r) => ({
        rev: acc.rev + r.rev,
        cogs: acc.cogs + r.cogs,
        fee: acc.fee + r.fee,
        ads: acc.ads + r.ads,
        profit: acc.profit + r.profit,
      }),
      { rev: 0, cogs: 0, fee: 0, ads: 0, profit: 0 }
    );
  }, [computedRows]);

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Tính lỗ lãi</h1>
      <p className="text-sm text-gray-500 mb-6">
        Nhập chi phí quảng cáo hàng ngày, sau đó tổng hợp lỗ lãi theo khoảng thời gian và từng sàn
      </p>

      {/* ============ BẢNG 1: QUẢNG CÁO ============ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">1. Quảng cáo</h2>
            <p className="text-sm text-gray-500">Phí quảng cáo hàng ngày theo từng sàn</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={addAdRow}>
              <Plus size={14} /> Thêm ngày
            </button>
            <button className="btn btn-primary btn-sm" disabled={savingAds} onClick={saveAds}>
              <Save size={14} /> {savingAds ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>

        {adAlert && (
          <div
            className={`mb-3 px-4 py-2 rounded-md text-sm ${
              adAlert.startsWith('✓')
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {adAlert}
          </div>
        )}

        <div className="card !p-0 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Ngày</th>
                <th className="text-right">QC Shopee</th>
                <th className="text-right">QC TikTok Shop</th>
                <th className="text-right">Tổng ngày</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {adRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-10">
                    Chưa có dữ liệu — bấm "Thêm ngày"
                  </td>
                </tr>
              )}
              {adRows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="date"
                      className="input"
                      value={row.date}
                      onChange={e => updateAdRow(i, { date: e.target.value })}
                    />
                  </td>
                  <td className="text-right">
                    <input
                      type="number"
                      className="input text-right w-36"
                      value={row.shopee || ''}
                      placeholder="0"
                      onChange={e => updateAdRow(i, { shopee: +e.target.value || 0 })}
                    />
                  </td>
                  <td className="text-right">
                    <input
                      type="number"
                      className="input text-right w-36"
                      value={row.tiktok || ''}
                      placeholder="0"
                      onChange={e => updateAdRow(i, { tiktok: +e.target.value || 0 })}
                    />
                  </td>
                  <td className="text-right font-medium">
                    {fmt((+row.shopee || 0) + (+row.tiktok || 0))}
                  </td>
                  <td className="text-center">
                    <button
                      className="text-gray-400 hover:text-red-600"
                      onClick={() => removeAdRow(i)}
                      title="Xóa dòng"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============ BẢNG 2: TỔNG HỢP LỖ LÃI ============ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">2. Tổng hợp lỗ lãi</h2>
            <p className="text-sm text-gray-500">
              Doanh số &amp; giá vốn lấy từ đơn hàng (đã loại đơn hủy). Phí sàn tự điền, quảng cáo lấy từ bảng 1
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={addProfitRow}>
            <Plus size={14} /> Thêm dòng
          </button>
        </div>

        <div className="card !p-0 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 280 }}>Khoảng thời gian</th>
                <th style={{ minWidth: 140 }}>Sàn</th>
                <th className="text-right">Doanh số</th>
                <th className="text-right">Giá vốn hàng bán</th>
                <th className="text-right">Phí sàn</th>
                <th className="text-right">Quảng cáo</th>
                <th className="text-right">Lợi nhuận</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {computedRows.map(row => {
                const cls = row.profit >= 0 ? 'text-green-600' : 'text-red-600';
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          className="input"
                          value={row.from}
                          onChange={e => updateProfitRow(row.id, { from: e.target.value })}
                        />
                        <span className="text-gray-400">→</span>
                        <input
                          type="date"
                          className="input"
                          value={row.to}
                          onChange={e => updateProfitRow(row.id, { to: e.target.value })}
                        />
                      </div>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={row.platform}
                        onChange={e =>
                          updateProfitRow(row.id, { platform: e.target.value as Platform })
                        }
                      >
                        <option value="shopee">Shopee</option>
                        <option value="tiktok">TikTok Shop</option>
                      </select>
                    </td>
                    <td className="text-right">{fmt(row.rev)}</td>
                    <td className="text-right">{fmt(row.cogs)}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="input text-right w-32"
                        value={row.fee || ''}
                        placeholder="0"
                        onChange={e => updateProfitRow(row.id, { fee: +e.target.value || 0 })}
                      />
                    </td>
                    <td className="text-right">{fmt(row.ads)}</td>
                    <td className={`text-right font-bold ${cls}`}>{fmt(row.profit)}</td>
                    <td className="text-center">
                      <button
                        className="text-gray-400 hover:text-red-600"
                        onClick={() => removeProfitRow(row.id)}
                        title="Xóa dòng"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {computedRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-10">
                    Chưa có dòng nào — bấm "Thêm dòng"
                  </td>
                </tr>
              )}
            </tbody>
            {computedRows.length > 0 && (
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td colSpan={2} className="text-right">Tổng cộng</td>
                  <td className="text-right">{fmt(totals.rev)}</td>
                  <td className="text-right">{fmt(totals.cogs)}</td>
                  <td className="text-right">{fmt(totals.fee)}</td>
                  <td className="text-right">{fmt(totals.ads)}</td>
                  <td className={`text-right font-bold ${totals.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(totals.profit)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">
          Lợi nhuận = Doanh số − Giá vốn hàng bán − Phí sàn − Quảng cáo
        </p>
      </div>
    </div>
  );
}
