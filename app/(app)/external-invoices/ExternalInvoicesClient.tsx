'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmt } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, X, Search, Save, FileText, Package, AlertCircle,
} from 'lucide-react';

// ---- Kiểu dữ liệu ----
type Item = { code: string; name: string; qty: number; amount: number };

export type ExternalInvoice = {
  id?: number;
  order_id: string | null;
  company_name: string;
  tax_code: string | null;
  address: string | null;
  email: string | null;
  items: Item[];
  total_amount: number;
  note: string | null;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  initialInvoices: ExternalInvoice[];
};

const emptyItem = (): Item => ({ code: '', name: '', qty: 1, amount: 0 });

const emptyForm = (): ExternalInvoice => ({
  order_id: '',
  company_name: '',
  tax_code: '',
  address: '',
  email: '',
  items: [emptyItem()],
  total_amount: 0,
  note: '',
});

export default function ExternalInvoicesClient({ initialInvoices }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [invoices, setInvoices] = useState<ExternalInvoice[]>(initialInvoices);
  const [form, setForm] = useState<ExternalInvoice>(emptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState('');

  // ---- Tổng thành tiền tự tính từ items ----
  const formTotal = useMemo(
    () => form.items.reduce((s, it) => s + (Number(it.amount) || 0), 0),
    [form.items]
  );

  // ---- Cập nhật field công ty ----
  const setField = (k: keyof ExternalInvoice, v: any) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // ---- Cập nhật 1 mặt hàng ----
  const setItem = (idx: number, k: keyof Item, v: any) => {
    setForm(prev => {
      const items = prev.items.map((it, i) =>
        i === idx ? { ...it, [k]: k === 'qty' || k === 'amount' ? Number(v) || 0 : v } : it
      );
      return { ...prev, items };
    });
  };

  const addItem = () => setForm(prev => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const removeItem = (idx: number) =>
    setForm(prev => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== idx) : prev.items,
    }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setMsg(null);
  };

  // ---- Lưu (thêm mới hoặc cập nhật) ----
  const handleSave = async () => {
    setMsg(null);
    // Validate tối thiểu
    if (!form.company_name.trim()) {
      setMsg({ type: 'err', text: 'Vui lòng nhập tên công ty.' });
      return;
    }
    const cleanItems = form.items
      .filter(it => it.name.trim() || it.code.trim() || it.amount > 0)
      .map(it => ({
        code: it.code.trim(),
        name: it.name.trim(),
        qty: Number(it.qty) || 0,
        amount: Number(it.amount) || 0,
      }));
    if (cleanItems.length === 0) {
      setMsg({ type: 'err', text: 'Vui lòng nhập ít nhất một mặt hàng.' });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMsg({ type: 'err', text: 'Phiên đăng nhập hết hạn, vui lòng tải lại trang.' });
        setSaving(false);
        return;
      }

      const payload = {
        user_id: user.id,
        order_id: form.order_id?.trim() || null,
        company_name: form.company_name.trim(),
        tax_code: form.tax_code?.trim() || null,
        address: form.address?.trim() || null,
        email: form.email?.trim() || null,
        items: cleanItems,
        total_amount: cleanItems.reduce((s, it) => s + it.amount, 0),
        note: form.note?.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase
          .from('external_invoices')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('external_invoices').insert(payload);
        if (error) throw error;
      }

      // Tải lại danh sách
      const { data } = await supabase
        .from('external_invoices')
        .select('*')
        .order('created_at', { ascending: false });
      setInvoices((data as ExternalInvoice[]) || []);

      setMsg({ type: 'ok', text: editingId ? 'Đã cập nhật.' : 'Đã thêm hóa đơn ngoài.' });
      resetForm();
      router.refresh();
    } catch (e: any) {
      setMsg({ type: 'err', text: `Lỗi khi lưu: ${e?.message || 'không xác định'}` });
    } finally {
      setSaving(false);
    }
  };

  // ---- Sửa ----
  const handleEdit = (inv: ExternalInvoice) => {
    setForm({
      order_id: inv.order_id || '',
      company_name: inv.company_name,
      tax_code: inv.tax_code || '',
      address: inv.address || '',
      email: inv.email || '',
      items: inv.items?.length ? inv.items.map(it => ({ ...it })) : [emptyItem()],
      total_amount: inv.total_amount,
      note: inv.note || '',
    });
    setEditingId(inv.id || null);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ---- Xóa ----
  const handleDelete = async (id?: number) => {
    if (!id) return;
    if (!confirm('Xóa hóa đơn ngoài này?')) return;
    try {
      const { error } = await supabase.from('external_invoices').delete().eq('id', id);
      if (error) throw error;
      setInvoices(prev => prev.filter(i => i.id !== id));
      if (editingId === id) resetForm();
      router.refresh();
    } catch (e: any) {
      setMsg({ type: 'err', text: `Lỗi khi xóa: ${e?.message || 'không xác định'}` });
    }
  };

  // ---- Lọc bảng ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(inv =>
      [inv.order_id, inv.company_name, inv.tax_code, inv.email]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q)) ||
      inv.items?.some(it => `${it.code} ${it.name}`.toLowerCase().includes(q))
    );
  }, [invoices, search]);

  const inputCls =
    'w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Hóa đơn ngoài</h1>
      <p className="text-sm text-gray-500 mb-5">
        Nhập đơn cần xuất HĐ theo thông tin công ty (kê khai) — gồm đơn trên sàn (nhập mã đơn để link &amp; cảnh báo)
        và đơn ngoài sàn (để mã đơn trống).
      </p>

      {/* ====== FORM ====== */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={18} className="text-brand-600" />
          <h2 className="font-semibold">
            {editingId ? 'Sửa hóa đơn ngoài' : 'Thêm hóa đơn ngoài'}
          </h2>
          {editingId && (
            <button
              onClick={resetForm}
              className="ml-auto text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
            >
              <X size={14} /> Hủy sửa
            </button>
          )}
        </div>

        {/* Thông tin công ty */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelCls}>Tên công ty *</label>
            <input
              className={inputCls}
              value={form.company_name}
              onChange={e => setField('company_name', e.target.value)}
              placeholder="Công ty TNHH ABC"
            />
          </div>
          <div>
            <label className={labelCls}>Mã số thuế</label>
            <input
              className={inputCls}
              value={form.tax_code || ''}
              onChange={e => setField('tax_code', e.target.value)}
              placeholder="0312345678"
            />
          </div>
          <div>
            <label className={labelCls}>Địa chỉ</label>
            <input
              className={inputCls}
              value={form.address || ''}
              onChange={e => setField('address', e.target.value)}
              placeholder="Số nhà, đường, quận, thành phố"
            />
          </div>
          <div>
            <label className={labelCls}>Email nhận hóa đơn</label>
            <input
              className={inputCls}
              value={form.email || ''}
              onChange={e => setField('email', e.target.value)}
              placeholder="ketoan@congty.com"
            />
          </div>
          <div>
            <label className={labelCls}>
              Mã đơn hàng <span className="text-gray-400">(tùy chọn — nhập nếu là đơn trên sàn)</span>
            </label>
            <input
              className={inputCls}
              value={form.order_id || ''}
              onChange={e => setField('order_id', e.target.value)}
              placeholder="VD: 2605223BUYCHHY (để trống nếu đơn ngoài sàn)"
            />
          </div>
          <div>
            <label className={labelCls}>Ghi chú</label>
            <input
              className={inputCls}
              value={form.note || ''}
              onChange={e => setField('note', e.target.value)}
              placeholder="Ghi chú thêm (nếu có)"
            />
          </div>
        </div>

        {/* Mặt hàng */}
        <div className="flex items-center gap-2 mb-2">
          <Package size={16} className="text-gray-500" />
          <h3 className="text-sm font-medium text-gray-700">Mặt hàng</h3>
        </div>
        <div className="border border-gray-200 rounded-md overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-32">Mã hàng</th>
                <th className="text-left px-3 py-2 font-medium">Tên mặt hàng</th>
                <th className="text-right px-3 py-2 font-medium w-20">SL</th>
                <th className="text-right px-3 py-2 font-medium w-36">Thành tiền</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx} className="border-t border-gray-100">
                  <td className="px-2 py-1.5">
                    <input
                      className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none"
                      value={it.code}
                      onChange={e => setItem(idx, 'code', e.target.value)}
                      placeholder="OL215D"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none"
                      value={it.name}
                      onChange={e => setItem(idx, 'name', e.target.value)}
                      placeholder="Tên sản phẩm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      className="w-full px-2 py-1 text-sm text-right border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none"
                      value={it.qty}
                      onChange={e => setItem(idx, 'qty', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      className="w-full px-2 py-1 text-sm text-right border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none"
                      value={it.amount}
                      onChange={e => setItem(idx, 'amount', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-gray-400 hover:text-red-500"
                      title="Xóa mặt hàng"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-3 py-2 text-right text-sm font-medium text-gray-600">
                  Tổng thành tiền
                </td>
                <td className="px-3 py-2 text-right text-sm font-bold text-brand-700">
                  {fmt(formTotal)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={addItem}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-brand-700 border border-brand-200 bg-brand-50 rounded-md hover:bg-brand-100 transition"
          >
            <Plus size={15} /> Thêm mặt hàng
          </button>
          <div className="flex-1" />
          {msg && (
            <span
              className={`text-sm flex items-center gap-1.5 ${
                msg.type === 'ok' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {msg.type === 'err' && <AlertCircle size={15} />}
              {msg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 transition disabled:opacity-60"
          >
            <Save size={15} /> {saving ? 'Đang lưu…' : editingId ? 'Cập nhật' : 'Lưu'}
          </button>
        </div>
      </div>

      {/* ====== BẢNG LƯU ====== */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          <h2 className="font-semibold">Danh sách đã lưu</h2>
          <span className="text-sm text-gray-500">{filtered.length} hóa đơn</span>
          <div className="flex-1" />
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/40 w-64"
              placeholder="Tìm mã đơn, công ty, MST, mặt hàng…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Mã đơn</th>
                <th className="text-left px-3 py-2.5 font-medium">Công ty</th>
                <th className="text-left px-3 py-2.5 font-medium">MST</th>
                <th className="text-left px-3 py-2.5 font-medium">Email</th>
                <th className="text-left px-3 py-2.5 font-medium">Mặt hàng</th>
                <th className="text-right px-3 py-2.5 font-medium">Tổng tiền</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                    Chưa có hóa đơn ngoài nào. Nhập ở form phía trên để thêm.
                  </td>
                </tr>
              ) : (
                filtered.map(inv => (
                  <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-2.5 align-top">
                      {inv.order_id ? (
                        <span className="font-mono text-xs">{inv.order_id}</span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Ngoài sàn</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium">{inv.company_name}</div>
                      {inv.address && (
                        <div className="text-xs text-gray-500 mt-0.5">{inv.address}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs">{inv.tax_code || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-xs">{inv.email || '—'}</td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="space-y-0.5">
                        {inv.items?.map((it, i) => (
                          <div key={i} className="text-xs">
                            {it.code && <span className="font-mono text-gray-500">{it.code} </span>}
                            {it.name}
                            <span className="text-gray-400"> × {it.qty}</span>
                            <span className="text-gray-600"> = {fmt(it.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-right font-semibold">
                      {fmt(inv.total_amount)}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleEdit(inv)}
                          className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded"
                          title="Sửa"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(inv.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Xóa"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
