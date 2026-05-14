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
  const startX = useRef(0);
  const startW = useRef(0);
  const dragging = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = currentWidth;
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      onResize(startW.current + delta);
    };
    const onUp = () => {
      dragging.current = false;
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
      title="Kéo để chỉnh độ rộng cột"
    />
  );
}
