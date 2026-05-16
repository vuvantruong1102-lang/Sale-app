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

export default function Sidebar({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="w-60 bg-white border-r border-gray-200 fixed h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-tiktok rounded-lg flex items-center justify-center text-white">
            <ShoppingBag size={18} />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">Quản lý bán hàng</div>
            <div className="text-[10px] text-gray-500 leading-tight">Shopee + TikTok Shop</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {items.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-5 py-2.5 text-sm border-l-2 transition ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}>
              <Icon size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-100 p-4">
        <div className="text-xs text-gray-500 mb-2 truncate" title={email}>{email}</div>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md transition">
          <LogOut size={15} />
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}
