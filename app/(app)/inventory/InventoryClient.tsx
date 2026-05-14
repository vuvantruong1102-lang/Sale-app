'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Product } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtN, norm } from '@/lib/utils';
import { Plus, Search, Download, X, Edit2 } from 'lucide-react';
import * as XLSX from 'xlsx';

type Props = {
  initialProducts: Product[];
  orders: { sku: string | null; quantity: number | null; status: string | null }[];
};

export default function InventoryClient({ initialProducts, orders }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing?: Product }>({ open: false });
  const [form, setForm] = useState<Product>({ sku: '', name: '', stock_initial: 0, cost: 0, price: 0, unit: 'cái' });

  // Tính số lượng đã bán theo SKU (không tính đơn hủy)
  const soldMap = useMemo(() => {
    const m = new Map<string, number>();
    orders.forEach(o => {
      const sku = o.sku || '';
      if (!sku) return;
      if (norm(o.status).includes('đã hủy')) return;
      m.set(sku, (m.get(sku) || 0) + (o.quantity || 0));
    });
    return m;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = norm(search);
    let list = products.slice();
    if (q) list = list.filter(p => norm(p.sku).includes(q) || norm(p.name).includes(q));
    return list;
  }, [products, search]);

  const stats = useMemo(() => {
    let totalQty = 0, totalVal = 0, lowStock = 0;
    products.forEach(p => {
      const sold = soldMap.get(p.sku) || 0;
      const cur = (p.stock_initial || 0) - sold;
      totalQty += cur;
      totalVal += cur * (p.cost || 0);
      if (cur <= 5) lowStock++;
    });
    return { totalSku: products.length, totalQty, totalVal, lowStock };
  }, [products, soldMap]);

  const openAdd = () => {
    setForm({ sku: '', name: '', stock_initial: 0, cost: 0, price: 0, unit: 'cái' });
    setModal({ open: true });
  };
  const openEdit = (p: Product) => {
    setForm({ ...p });
    setModal({ open: true, editing: p });
  };
  const closeModal = () => setModal({ open: false });

  const save = async () => {
    if (!form.sku.trim() || !form.name.trim()) { alert('Nhập SKU và tên sản phẩm'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = { ...form, user_id: user.id };
    const { error } = await supabase.from('products').upsert(payload, { onConflict: 'user_id,sku' });
    if (error) { alert('Lỗi: ' + error.message); return; }
    // Reload
    const { data } = await supabase.from('products').select('*').order('sku');
    setProducts(data || []);
    closeModal();
    router.refresh();
  };

  const handleExport = () => {
    const rows = products.map(p => {
      const sold = soldMap.get(p.sku) || 0;
      const cur = (p.stock_initial || 0) - sold;
      return {
        'SKU': p.sku, 'Tên SP': p.name, 'Tồn đầu kỳ': p.stock_initial, 'Đã bán': sold,
        'Tồn hiện tại': cur, 'Giá vốn': p.cost, 'Giá bán': p.price,
        'Đơn vị': p.unit, 'Giá trị tồn': cur * (p.cost || 0),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tồn kho');
    XLSX.writeFile(wb, 'ton-kho-' + Date.now() + '.xlsx');
  };

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold mb-1">Hàng tồn kho</h1>
      <p className="text-sm text-gray-500 mb-5">SKU tự đồng bộ từ đơn hàng — nhập giá vốn và tồn kho ban đầu để tính lợi nhuận chính xác</p>

      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={15} /> Thêm sản phẩm
        </button>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-64" placeholder="Tìm SKU, tên..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={14} /> Xuất Excel
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KPI title="Tổng SKU" value={stats.totalSku.toString()} />
        <KPI title="Tổng SL tồn" value={fmtN(stats.totalQty)} />
        <KPI title="Giá trị tồn (giá vốn)" value={fmt(stats.totalVal)} />
        <KPI title="Sắp hết hàng" value={stats.lowStock.toString()} sub="Tồn ≤ 5" color="text-yellow-600" />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="tbl">
          <thead><tr>
            <th>SKU</th><th>Tên sản phẩm</th>
            <th className="text-right">Tồn đầu kỳ</th>
            <th className="text-right">Đã bán</th>
            <th className="text-right">Tồn hiện tại</th>
            <th className="text-right">Giá vốn</th>
            <th className="text-right">Giá bán</th>
            <th>Đơn vị</th>
            <th className="text-right">Giá trị tồn</th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center text-gray-400 py-12">
                Chưa có SKU — import đơn hàng trước, hoặc bấm "Thêm sản phẩm"
              </td></tr>
            )}
            {filtered.map(p => {
              const sold = soldMap.get(p.sku) || 0;
              const cur = (p.stock_initial || 0) - sold;
              const low = cur <= 5;
              return (
                <tr key={p.sku}>
                  <td className="font-medium">{p.sku}</td>
                  <td><div className="max-w-[280px] truncate" title={p.name}>{p.name}</div></td>
                  <td className="text-right">{fmtN(p.stock_initial)}</td>
                  <td className="text-right">{fmtN(sold)}</td>
                  <td className={`text-right font-medium ${low ? 'text-yellow-600' : ''}`}>{fmtN(cur)}</td>
                  <td className="text-right">{fmt(p.cost)}</td>
                  <td className="text-right">{fmt(p.price)}</td>
                  <td>{p.unit || 'cái'}</td>
                  <td className="text-right">{fmt(cur * (p.cost || 0))}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>
                      <Edit2 size={12} /> Sửa
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold">{modal.editing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">SKU phân loại *</label>
                <input className="input w-full" value={form.sku} disabled={!!modal.editing}
                  onChange={e => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div>
                <label className="label">Tên sản phẩm *</label>
                <input className="input w-full" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Tồn kho ban đầu</label>
                  <input type="number" className="input w-full" value={form.stock_initial || 0}
                    onChange={e => setForm({ ...form, stock_initial: +e.target.value })} />
                </div>
                <div>
                  <label className="label">Đơn vị</label>
                  <input className="input w-full" value={form.unit || 'cái'}
                    onChange={e => setForm({ ...form, unit: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Giá vốn (VND)</label>
                  <input type="number" className="input w-full" value={form.cost || 0}
                    onChange={e => setForm({ ...form, cost: +e.target.value })} />
                </div>
                <div>
                  <label className="label">Giá bán (VND)</label>
                  <input type="number" className="input w-full" value={form.price || 0}
                    onChange={e => setForm({ ...form, price: +e.target.value })} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button className="btn btn-primary" onClick={save}>Lưu</button>
            </div>
          </div>
        </div>
      )}
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
