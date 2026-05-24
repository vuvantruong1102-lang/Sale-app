'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmt } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, X, Search, Save, FileText, Package, AlertCircle,
} from 'lucide-react';

// ---- Kiểu dữ liệu ----
type Item = { code: string; name: string; qty: number; price: number; amount: number };

type ProductOpt = { sku: string; name: string; invoice_name?: string | null; price?: number | null };

type OrderRow = {
  order_id: string;
  sku: string | null;
  product_name: string | null;
  quantity: number | null;
  price_deal: number | null;
};

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
  is_exported?: boolean;
  invoice_no?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  initialInvoices: ExternalInvoice[];
  products?: ProductOpt[];
  orders?: OrderRow[];
  invoiceStatus?: { order_id: string; invoice_no: string | null }[];
};

const emptyItem = (): Item => ({ code: '', name: '', qty: 1, price: 0, amount: 0 });

const emptyForm = (): ExternalInvoice => ({
  order_id: '',
  company_name: '',
  tax_code: '',
  address: '',
  email: '',
  items: [emptyItem()],
  total_amount: 0,
  note: '',
  is_exported: false,
  invoice_no: '',
});

export default function ExternalInvoicesClient({ initialInvoices, products = [], orders = [], invoiceStatus = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [invoices, setInvoices] = useState<ExternalInvoice[]>(initialInvoices);
  const [form, setForm] = useState<ExternalInvoice>(emptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [activeCodeRow, setActiveCodeRow] = useState<number | null>(null); // dòng đang gõ mã hàng

  // ---- Tổng thành tiền tự tính từ items ----
  const formTotal = useMemo(
    () => form.items.reduce((s, it) => s + (Number(it.amount) || 0), 0),
    [form.items]
  );

  // ---- Cập nhật field công ty ----
  const setField = (k: keyof ExternalInvoice, v: any) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // ---- Gom các dòng đơn hàng theo order_id (1 đơn có thể nhiều SKU) ----
  const ordersByOid = useMemo(() => {
    const m = new Map<string, OrderRow[]>();
    orders.forEach(o => {
      const oid = String(o.order_id || '').trim();
      if (!oid) return;
      const arr = m.get(oid) || [];
      arr.push(o);
      m.set(oid, arr);
    });
    return m;
  }, [orders]);

  // Set order_id có thật trên sàn (Shopee/TikTok) → dùng để gắn badge "Đơn ngoài"
  const platformOrderIds = useMemo(() => {
    const s = new Set<string>();
    orders.forEach(o => { if (o.order_id) s.add(String(o.order_id).trim()); });
    return s;
  }, [orders]);

  // Map order_id -> số hóa đơn (từ file Hóa đơn đã import) để tự đề xuất
  const invoiceNoByOid = useMemo(() => {
    const m = new Map<string, string>();
    invoiceStatus.forEach(s => {
      const oid = String(s.order_id || '').trim();
      if (oid && s.invoice_no) m.set(oid, s.invoice_no);
    });
    return m;
  }, [invoiceStatus]);

  // Đơn có phải "đơn ngoài" không (mã trống hoặc không khớp đơn sàn)
  const isExternal = (orderId: string | null) => {
    const oid = String(orderId || '').trim();
    return !oid || !platformOrderIds.has(oid);
  };

  // ---- Tự fill mặt hàng từ mã đơn (ghi đè toàn bộ) khi mã khớp đơn trên sàn ----
  const fillFromOrder = (oid: string) => {
    const key = oid.trim();
    if (!key) return;
    const lines = ordersByOid.get(key);
    if (!lines || lines.length === 0) {
      setMsg({ type: 'err', text: `Không tìm thấy đơn "${key}" trên sàn. Bạn vẫn có thể nhập mặt hàng thủ công.` });
      return;
    }
    const items: Item[] = lines.map(l => {
      const qty = Number(l.quantity) || 1;
      const price = Number(l.price_deal) || 0;
      return {
        code: l.sku || '',
        name: l.product_name || '',   // tên sản phẩm trên đơn
        qty,
        price,
        amount: price * qty,
      };
    });
    setForm(prev => ({
      ...prev,
      items,
      // Tự đề xuất số HĐ từ file Hóa đơn (cho sửa tay sau)
      invoice_no: invoiceNoByOid.get(key) || prev.invoice_no || '',
    }));
    setMsg({ type: 'ok', text: `Đã tự điền ${items.length} mặt hàng từ đơn ${key}.` });
  };

  // ---- Cập nhật 1 mặt hàng (tự tính thành tiền = giá bán × SL) ----
  const setItem = (idx: number, k: keyof Item, v: any) => {
    setForm(prev => {
      const items = prev.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [k]: (k === 'qty' || k === 'price' || k === 'amount') ? Number(v) || 0 : v };
        // Khi đổi giá bán hoặc số lượng → tự tính lại thành tiền
        if (k === 'price' || k === 'qty') {
          next.amount = (Number(next.price) || 0) * (Number(next.qty) || 0);
        }
        return next;
      });
      return { ...prev, items };
    });
  };

  // ---- Chọn 1 mã hàng từ gợi ý → fill mã, tên (ưu tiên tên hóa đơn), giá bán ----
  const pickProduct = (idx: number, p: ProductOpt) => {
    setForm(prev => {
      const items = prev.items.map((it, i) => {
        if (i !== idx) return it;
        const price = Number(p.price) || it.price || 0;
        const qty = Number(it.qty) || 1;
        return {
          ...it,
          code: p.sku,
          name: (p.invoice_name && p.invoice_name.trim()) || p.name || it.name,
          price,
          amount: price * qty,
        };
      });
      return { ...prev, items };
    });
    setActiveCodeRow(null);
  };

  // ---- Gợi ý mã hàng theo chuỗi đang gõ ----
  const codeSuggestions = (q: string): ProductOpt[] => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 8);
    return products
      .filter(p =>
        p.sku.toLowerCase().includes(s) ||
        p.name.toLowerCase().includes(s) ||
        (p.invoice_name || '').toLowerCase().includes(s)
      )
      .slice(0, 8);
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
    setActiveCodeRow(null);
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
        price: Number(it.price) || 0,
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
        is_exported: !!form.is_exported,
        invoice_no: form.invoice_no?.trim() || null,
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
      items: inv.items?.length
        ? inv.items.map(it => ({
            ...it,
            // Bản ghi cũ có thể chưa có price → suy ra từ thành tiền / SL
            price: (it as any).price ?? (it.qty ? Math.round((it.amount || 0) / it.qty) : 0),
          }))
        : [emptyItem()],
      total_amount: inv.total_amount,
      note: inv.note || '',
      is_exported: !!inv.is_exported,
      invoice_no: inv.invoice_no || '',
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

  // ---- Tick "Đã xuất HĐ" trực tiếp trên bảng ----
  const toggleExported = async (inv: ExternalInvoice) => {
    if (!inv.id) return;
    const next = !inv.is_exported;
    setInvoices(prev => prev.map(i => (i.id === inv.id ? { ...i, is_exported: next } : i)));
    try {
      const { error } = await supabase
        .from('external_invoices')
        .update({ is_exported: next, updated_at: new Date().toISOString() })
        .eq('id', inv.id);
      if (error) throw error;
    } catch (e: any) {
      // Khôi phục nếu lỗi
      setInvoices(prev => prev.map(i => (i.id === inv.id ? { ...i, is_exported: !next } : i)));
      setMsg({ type: 'err', text: `Lỗi cập nhật: ${e?.message || 'không xác định'}` });
    }
  };

  // ---- Sửa số hóa đơn trực tiếp trên bảng (lưu khi rời ô) ----
  const saveInvoiceNo = async (inv: ExternalInvoice, value: string) => {
    if (!inv.id) return;
    const v = value.trim() || null;
    if ((inv.invoice_no || null) === v) return; // không đổi
    setInvoices(prev => prev.map(i => (i.id === inv.id ? { ...i, invoice_no: v } : i)));
    try {
      const { error } = await supabase
        .from('external_invoices')
        .update({ invoice_no: v, updated_at: new Date().toISOString() })
        .eq('id', inv.id);
      if (error) throw error;
    } catch (e: any) {
      setMsg({ type: 'err', text: `Lỗi cập nhật số HĐ: ${e?.message || 'không xác định'}` });
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
    <div className="w-full">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
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
              Mã đơn hàng <span className="text-gray-400">(tùy chọn — nhập nếu là đơn trên sàn để tự điền mặt hàng)</span>
            </label>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={form.order_id || ''}
                onChange={e => setField('order_id', e.target.value)}
                onBlur={e => { if (e.target.value.trim()) fillFromOrder(e.target.value); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fillFromOrder(form.order_id || ''); } }}
                placeholder="VD: 2605223BUYCHHY (để trống nếu đơn ngoài sàn)"
              />
              <button
                type="button"
                onClick={() => fillFromOrder(form.order_id || '')}
                className="shrink-0 px-3 py-2 text-sm text-brand-700 border border-brand-200 bg-brand-50 rounded-md hover:bg-brand-100 transition whitespace-nowrap"
                title="Tự điền mặt hàng từ đơn trên sàn"
              >
                Tự điền
              </button>
            </div>
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
          <div>
            <label className={labelCls}>
              Số hóa đơn <span className="text-gray-400">(đơn từ sàn sẽ tự đề xuất)</span>
            </label>
            <input
              className={inputCls}
              value={form.invoice_no || ''}
              onChange={e => setField('invoice_no', e.target.value)}
              placeholder="Số HĐ (nếu đã có)"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.is_exported}
                onChange={e => setField('is_exported', e.target.checked)}
                className="w-4 h-4 accent-brand-600"
              />
              Đã xuất hóa đơn
            </label>
          </div>
        </div>

        {/* Mặt hàng */}
        <div className="flex items-center gap-2 mb-2">
          <Package size={16} className="text-gray-500" />
          <h3 className="text-sm font-medium text-gray-700">Mặt hàng</h3>
        </div>
        <div className="border border-gray-200 rounded-md mb-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-36">Mã hàng</th>
                <th className="text-left px-3 py-2 font-medium">Tên mặt hàng</th>
                <th className="text-right px-3 py-2 font-medium w-24">SL</th>
                <th className="text-right px-3 py-2 font-medium w-32">Giá bán</th>
                <th className="text-right px-3 py-2 font-medium w-36">Thành tiền</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 relative">
                    <input
                      className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none"
                      value={it.code}
                      onChange={e => { setItem(idx, 'code', e.target.value); setActiveCodeRow(idx); }}
                      onFocus={() => setActiveCodeRow(idx)}
                      onBlur={() => setTimeout(() => setActiveCodeRow(c => (c === idx ? null : c)), 150)}
                      placeholder="Gõ mã hàng…"
                      autoComplete="off"
                    />
                    {activeCodeRow === idx && products.length > 0 && (() => {
                      const sugg = codeSuggestions(it.code);
                      if (sugg.length === 0) return null;
                      return (
                        <div className="absolute z-20 left-2 right-2 mt-0.5 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {sugg.map(p => (
                            <button
                              key={p.sku}
                              type="button"
                              onMouseDown={e => { e.preventDefault(); pickProduct(idx, p); }}
                              className="w-full text-left px-3 py-2 hover:bg-brand-50 border-b border-gray-50 last:border-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-medium text-gray-700">{p.sku}</span>
                                {p.price != null && p.price > 0 && (
                                  <span className="text-xs text-gray-500">{fmt(p.price)}</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {(p.invoice_name && p.invoice_name.trim()) || p.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none"
                      value={it.name}
                      onChange={e => setItem(idx, 'name', e.target.value)}
                      placeholder="Tên hóa đơn (tự điền khi chọn mã)"
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
                      value={it.price}
                      onChange={e => setItem(idx, 'price', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      className="w-full px-2 py-1 text-sm text-right border border-transparent hover:border-gray-200 focus:border-brand-500 rounded focus:outline-none bg-gray-50"
                      value={it.amount}
                      onChange={e => setItem(idx, 'amount', e.target.value)}
                      title="Tự tính = Giá bán × SL (có thể sửa tay)"
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
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-medium text-gray-600">
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
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th style={{ width: 130, resize: 'horizontal', overflow: 'hidden' }} className="text-left px-3 py-2.5 font-medium">Mã đơn</th>
                <th style={{ width: 240, resize: 'horizontal', overflow: 'hidden' }} className="text-left px-3 py-2.5 font-medium">Công ty</th>
                <th style={{ width: 120, resize: 'horizontal', overflow: 'hidden' }} className="text-left px-3 py-2.5 font-medium">MST</th>
                <th style={{ width: 180, resize: 'horizontal', overflow: 'hidden' }} className="text-left px-3 py-2.5 font-medium">Email</th>
                <th style={{ width: 300, resize: 'horizontal', overflow: 'hidden' }} className="text-left px-3 py-2.5 font-medium">Mặt hàng</th>
                <th style={{ width: 110, resize: 'horizontal', overflow: 'hidden' }} className="text-right px-3 py-2.5 font-medium">Tổng tiền</th>
                <th style={{ width: 90, resize: 'horizontal', overflow: 'hidden' }} className="text-center px-3 py-2.5 font-medium">Đã xuất HĐ</th>
                <th style={{ width: 130, resize: 'horizontal', overflow: 'hidden' }} className="text-left px-3 py-2.5 font-medium">Số HĐ</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-400">
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
                        <span className="text-xs text-gray-400">—</span>
                      )}
                      {isExternal(inv.order_id) && (
                        <span className="ml-1 inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700 align-middle">
                          Đơn ngoài
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium whitespace-normal break-words">{inv.company_name}</div>
                      {inv.address && (
                        <div className="text-xs text-gray-500 mt-0.5 whitespace-normal break-words">{inv.address}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs whitespace-nowrap">{inv.tax_code || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-xs break-all">{inv.email || '—'}</td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="space-y-0.5 max-w-[280px]">
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
                    <td className="px-3 py-2.5 align-top text-center">
                      <input
                        type="checkbox"
                        checked={!!inv.is_exported}
                        onChange={() => toggleExported(inv)}
                        className="w-4 h-4 accent-brand-600 cursor-pointer"
                        title="Đánh dấu đã xuất hóa đơn"
                      />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <input
                        key={`inv-no-${inv.id}-${inv.invoice_no || ''}`}
                        defaultValue={inv.invoice_no || ''}
                        onBlur={e => saveInvoiceNo(inv, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        placeholder="Nhập số HĐ"
                        className="w-32 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                      />
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
