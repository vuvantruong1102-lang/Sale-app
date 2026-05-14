'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type ColDef = {
  key: string;
  width: number;
  minWidth?: number;
};

export function useResizableCols(storageKey: string, defaults: ColDef[]) {
  const [cols, setCols] = useState<ColDef[]>(defaults);
  const loaded = useRef(false);

  // Load từ localStorage khi mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, number>;
        setCols(defaults.map(c => ({
          ...c,
          width: saved[c.key] && saved[c.key] >= (c.minWidth || 50) ? saved[c.key] : c.width,
        })));
      }
    } catch {}
  }, [storageKey]); // eslint-disable-line

  const save = useCallback((next: ColDef[]) => {
    const map: Record<string, number> = {};
    next.forEach(c => { map[c.key] = c.width; });
    localStorage.setItem(storageKey, JSON.stringify(map));
  }, [storageKey]);

  const setWidth = useCallback((key: string, width: number) => {
    setCols(prev => {
      const next = prev.map(c => c.key === key ? { ...c, width: Math.max(c.minWidth || 50, width) } : c);
      save(next);
      return next;
    });
  }, [save]);

  const reset = useCallback(() => {
    setCols(defaults);
    localStorage.removeItem(storageKey);
  }, [defaults, storageKey]);

  return { cols, setWidth, reset };
}

// Component handle để kéo resize
export function ResizeHandle({
  onResize,
  currentWidth,
}: {
  onResize: (newWidth: number) => void;
  currentWidth: number;
}) {
  // Dùng ref để giữ giá trị current width tại thời điểm bắt đầu kéo
  // tránh stale closure khi state cập nhật
  const widthRef = useRef(currentWidth);
  widthRef.current = currentWidth;

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthRef.current;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const delta = ev.clientX - startX;
      onResize(startW + delta);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <span
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      className="col-resize-handle"
      role="separator"
      aria-label="Kéo để chỉnh độ rộng cột"
    />
  );
}
