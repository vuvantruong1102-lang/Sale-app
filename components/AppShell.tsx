'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './Sidebar';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 168; // 70% × 240

export default function AppShell({
  email,
  children,
}: {
  email?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const savedCollapsed = localStorage.getItem('sidebar-collapsed');
    if (savedCollapsed === '1') setCollapsed(true);
    const savedW = localStorage.getItem('sidebar-width');
    if (savedW) {
      const w = parseInt(savedW, 10);
      if (!isNaN(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) setWidth(w);
    }
    setHydrated(true);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    let next = dragRef.current.startW + delta;
    if (next < MIN_WIDTH) next = MIN_WIDTH;
    if (next > MAX_WIDTH) next = MAX_WIDTH;
    setWidth(next);
  }, []);

  const onMouseUp = useCallback(() => {
    if (dragRef.current) {
      localStorage.setItem('sidebar-width', String(width));
    }
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [width, onMouseMove]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <main className="flex-1 p-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {!collapsed && (
        <>
          <Sidebar email={email} width={width} />
          <div
            onMouseDown={startDrag}
            className="fixed top-0 h-screen z-40 cursor-col-resize hover:bg-brand-500/30 transition-colors group"
            style={{ left: width - 3, width: 6 }}
            title="Kéo để đổi độ rộng"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-transparent group-hover:bg-brand-500" />
          </div>
        </>
      )}
      <main
        className="flex-1 p-6 transition-[margin] duration-100"
        style={{ marginLeft: collapsed ? 0 : width }}
      >
        <button
          onClick={toggle}
          className="fixed z-50 top-4 bg-white border border-gray-200 rounded-md p-1.5 shadow-sm hover:bg-gray-50 transition"
          style={{ left: collapsed ? 16 : width - 20 }}
          title={collapsed ? 'Hiện sidebar' : 'Ẩn sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        {children}
      </main>
    </div>
  );
}
