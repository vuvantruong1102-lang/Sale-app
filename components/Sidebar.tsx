'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  LayoutDashboard, Package, Boxes, Megaphone, Receipt,
  TrendingUp, Settings, LogOut, ShoppingBag, RotateCcw,
} from 'lucide-react';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/orders', label: 'Đơn hàng', icon: Package },
  { href: '/returns', label: 'Đơn hủy/Trả hàng', icon: RotateCcw },
  { href: '/inventory', label: 'Hàng tồn kho', icon: Boxes },
  { href: '/ads', label: 'Quảng cáo', icon: Megaphone },
  { href: '/invoices', label: 'Hóa đơn', icon: Receipt },
  { href: '/profit', label: 'Lỗ lãi', icon: TrendingUp },
  { href: '/settings', label: 'Cài đặt', icon: Settings },
];

export default function Sidebar({ email, width = 240 }: { email?: string; width?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const compact = width < 180; // chế độ co cho width nhỏ

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside
      className="bg-white border-r border-gray-200 fixed h-screen flex flex-col"
      style={{ width }}
    >
      <div className={`${compact ? 'px-3 py-4' : 'px-5 py-5'} border-b border-gray-100`}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-brand-500 to-tiktok rounded-lg flex items-center justify-center text-white">
            <ShoppingBag size={18} />
          </div>
          <div className="min-w-0">
            <div className={`font-bold leading-tight truncate ${compact ? 'text-xs' : 'text-sm'}`}>Quản lý bán hàng</div>
            <div className="text-[10px] text-gray-500 leading-tight truncate">Shopee + TikTok Shop</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {items.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 ${compact ? 'px-3' : 'px-5'} py-2.5 text-sm border-l-2 transition ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
              title={item.label}>
              <Icon size={17} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-gray-100 ${compact ? 'p-3' : 'p-4'}`}>
        <div className="text-xs text-gray-500 mb-2 truncate" title={email}>{email}</div>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md transition">
          <LogOut size={15} className="shrink-0" />
          <span className="truncate">Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
