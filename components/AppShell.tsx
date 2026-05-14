'use client';

import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export default function AppShell({
  email,
  children,
}: {
  email?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Lưu trạng thái sidebar vào localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === '1') setCollapsed(true);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {!collapsed && <Sidebar email={email} />}
      <main
        className="flex-1 p-6 transition-all"
        style={{ marginLeft: collapsed ? 0 : 240 }}
      >
        <button
          onClick={toggle}
          className="fixed z-50 top-4 bg-white border border-gray-200 rounded-md p-1.5 shadow-sm hover:bg-gray-50 transition"
          style={{ left: collapsed ? 16 : 220 }}
          title={collapsed ? 'Hiện sidebar' : 'Ẩn sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        {children}
      </main>
    </div>
  );
}
