'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Settings } from '@/lib/types';
import { AlertTriangle } from 'lucide-react';

export default function SettingsClient({ initialSettings }: { initialSettings: Settings }) {
  const router = useRouter();
  const supabase = createClient();
  const [revRule, setRevRule] = useState(initialSettings.rev_rule || 'shipping');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async (rule: string) => {
    setSaving(true); setMsg('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from('settings')
      .upsert({ user_id: user.id, rev_rule: rule, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (!error) setMsg('✓ Đã lưu');
    setSaving(false);
    router.refresh();
    setTimeout(() => setMsg(''), 3000);
  };

  const clearAll = async () => {
    if (!confirm('Xóa TẤT CẢ dữ liệu (đơn hàng, sản phẩm, QC, hóa đơn)? Không thể khôi phục!')) return;
    if (!confirm('Bạn chắc chắn? Tất cả dữ liệu sẽ bị xóa vĩnh viễn.')) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await Promise.all([
      supabase.from('orders').delete().eq('user_id', user.id),
      supabase.from('products').delete().eq('user_id', user.id),
      supabase.from('ads').delete().eq('user_id', user.id),
      supabase.from('invoices').delete().eq('user_id', user.id),
    ]);
    alert('✓ Đã xóa tất cả dữ liệu');
    router.refresh();
  };

  return (
    <div className="fade-in max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Cài đặt</h1>
      <p className="text-sm text-gray-500 mb-6">Quản lý các tùy chọn của phần mềm</p>

      <div className="card mb-4">
        <h3 className="font-semibold mb-1">Quy tắc tính doanh thu</h3>
        <p className="text-sm text-gray-500 mb-4">Đơn hàng có trạng thái nào sẽ được tính vào doanh thu</p>
        <div className="space-y-2">
          {[
            { v: 'completed', label: 'Chỉ đơn "Đã giao" + "Hoàn thành"', desc: 'Chặt chẽ nhất, chỉ tính khi đơn thực sự hoàn tất' },
            { v: 'shipping', label: 'Cả "Đang giao" (trừ "Đã hủy")', desc: 'Phổ biến — phản ánh đúng tình hình kinh doanh' },
            { v: 'all_except_cancel', label: 'Tất cả trừ "Đã hủy"', desc: 'Bao gồm cả đơn chờ giao' },
          ].map(opt => (
            <label key={opt.v} className="flex items-start gap-3 p-3 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer">
              <input type="radio" name="rev" checked={revRule === opt.v}
                onChange={() => { setRevRule(opt.v as any); save(opt.v); }}
                className="mt-1 accent-brand-500" />
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-gray-500">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        {msg && <div className="mt-3 text-sm text-green-600">{msg}</div>}
      </div>

      <div className="card border-red-200">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={18} className="text-red-500" />
          <h3 className="font-semibold text-red-700">Vùng nguy hiểm</h3>
        </div>
        <p className="text-sm text-gray-500 mb-4">Xóa toàn bộ dữ liệu của tài khoản, không thể khôi phục</p>
        <button className="btn btn-danger" onClick={clearAll} disabled={saving}>
          Xóa tất cả dữ liệu
        </button>
      </div>
    </div>
  );
}
