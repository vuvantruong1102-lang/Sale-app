'use client';

import { useState, useRef, useEffect } from 'react';
import { Filter, Check } from 'lucide-react';
import { norm } from '@/lib/utils';
import { ResizeHandle } from '@/lib/useResizableCols';

// Type cho mỗi col filter dùng chung giữa các trang
// - 'list':   checkbox danh sách value (text/category)
// - 'number': range min/max
// - 'text':   search contains (lưu vào `selected` Set với 1 phần tử)
// - 'date':   range from/to
export type ColFilter =
  | { type: 'list'; selected: Set<string> }
  | { type: 'number'; min?: number; max?: number }
  | { type: 'date'; from?: string; to?: string };

// ============ COMPONENT: HEADER CỘT CÓ FILTER ============
type ColHeaderProps = {
  label: string;
  colKey: string;
  width: number;
  onResize?: (w: number) => void;
  align?: 'left' | 'right';
  noResize?: boolean;
  filterable?: boolean;
  filterType?: 'list' | 'number' | 'text' | 'date';
  filterValues?: string[];
  filters?: Record<string, ColFilter>;
  setFilters?: (f: Record<string, ColFilter>) => void;
  open?: string | null;
  setOpen?: (k: string | null) => void;
  onPageChange?: () => void;
};

export function ColHeader({
  label, colKey, width, onResize, align, noResize,
  filterable, filterType, filterValues, filters, setFilters, open, setOpen, onPageChange,
}: ColHeaderProps) {
  const f = filters?.[colKey];
  const hasFilter = !!f && (
    (f.type === 'list' && f.selected.size > 0) ||
    (f.type === 'number' && (f.min !== undefined || f.max !== undefined)) ||
    (f.type === 'date' && (f.from !== undefined || f.to !== undefined))
  );
  const isOpen = open === colKey;

  return (
    <th className={align === 'right' ? 'text-right' : ''}>
      <div className="flex items-center gap-1" style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <span>{label}</span>
        {filterable && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen?.(isOpen ? null : colKey); }}
            className={`filter-btn ${hasFilter ? 'active' : ''}`}
            title={hasFilter ? 'Đang lọc cột này' : 'Lọc'}
          >
            <Filter size={11} />
          </button>
        )}
      </div>
      {isOpen && filterable && (
        <FilterPopup
          colKey={colKey}
          type={filterType!}
          values={filterValues}
          current={f}
          onApply={(newFilter) => {
            const next = { ...(filters || {}) };
            if (newFilter) next[colKey] = newFilter;
            else delete next[colKey];
            setFilters?.(next);
            setOpen?.(null);
            onPageChange?.();
          }}
          onClose={() => setOpen?.(null)}
        />
      )}
      {!noResize && onResize && <ResizeHandle currentWidth={width} onResize={onResize} />}
    </th>
  );
}

// ============ COMPONENT: POPUP FILTER ============
type FilterPopupProps = {
  colKey: string;
  type: 'list' | 'number' | 'text' | 'date';
  values?: string[];
  current?: ColFilter;
  onApply: (f: ColFilter | null) => void;
  onClose: () => void;
};

function FilterPopup({ type, values, current, onApply, onClose }: FilterPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // Click outside để đóng
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  // ===== LIST FILTER (checkbox) =====
  if (type === 'list') {
    const [selected, setSelected] = useState<Set<string>>(
      current?.type === 'list' ? new Set(current.selected) : new Set()
    );
    const [searchVal, setSearchVal] = useState('');
    const all = (values || []).filter(v => norm(v).includes(norm(searchVal)));
    const allSelected = selected.size === 0; // empty = all
    const toggleOne = (v: string) => {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v); else next.add(v);
      setSelected(next);
    };
    const selectAll = () => setSelected(new Set());
    const selectNone = () => setSelected(new Set(values || []));

    return (
      <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
        <input className="input input-sm w-full mb-2" placeholder="Tìm trong giá trị..." value={searchVal}
          onChange={e => setSearchVal(e.target.value)} autoFocus />
        <div className="flex gap-2 mb-2 text-xs">
          <button className="text-brand-500 hover:underline" onClick={selectAll}>Chọn tất cả</button>
          <span className="text-gray-300">|</span>
          <button className="text-brand-500 hover:underline" onClick={selectNone}>Bỏ chọn tất cả</button>
        </div>
        <div className="filter-list">
          {all.length === 0 && <div className="text-xs text-gray-400 p-2 text-center">Không có giá trị</div>}
          {all.map(v => {
            const checked = allSelected ? true : selected.has(v);
            return (
              <label key={v} className="filter-item">
                <input type="checkbox" checked={checked} onChange={() => toggleOne(v)} />
                <span className="truncate" title={v}>{v}</span>
              </label>
            );
          })}
        </div>
        <div className="filter-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => { onApply(null); }}>Xóa lọc</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            onApply(selected.size === 0 ? null : { type: 'list', selected });
          }}>
            <Check size={12} /> Áp dụng
          </button>
        </div>
      </div>
    );
  }

  // ===== NUMBER FILTER (min/max) =====
  if (type === 'number') {
    const [min, setMin] = useState<string>(
      current?.type === 'number' && current.min !== undefined ? String(current.min) : ''
    );
    const [max, setMax] = useState<string>(
      current?.type === 'number' && current.max !== undefined ? String(current.max) : ''
    );
    return (
      <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-gray-500 mb-2">Khoảng giá trị</div>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-gray-500">Từ:</label>
            <input type="number" className="input input-sm w-full" placeholder="Không giới hạn"
              value={min} onChange={e => setMin(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-[11px] text-gray-500">Đến:</label>
            <input type="number" className="input input-sm w-full" placeholder="Không giới hạn"
              value={max} onChange={e => setMax(e.target.value)} />
          </div>
        </div>
        <div className="filter-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onApply(null)}>Xóa lọc</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            const f: ColFilter = { type: 'number' };
            if (min !== '' && !isNaN(+min)) f.min = +min;
            if (max !== '' && !isNaN(+max)) f.max = +max;
            if (f.min === undefined && f.max === undefined) onApply(null);
            else onApply(f);
          }}>
            <Check size={12} /> Áp dụng
          </button>
        </div>
      </div>
    );
  }

  // ===== DATE FILTER =====
  if (type === 'date') {
    const toLocalYMD = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const today = toLocalYMD(new Date());
    const [from, setFrom] = useState<string>(
      current?.type === 'date' && current.from ? current.from : ''
    );
    const [to, setTo] = useState<string>(
      current?.type === 'date' && current.to ? current.to : ''
    );
    const setRange = (days: number) => {
      const d = new Date();
      const toStr = toLocalYMD(d);
      d.setDate(d.getDate() - days + 1);
      setFrom(toLocalYMD(d));
      setTo(toStr);
    };
    const setMonth = () => {
      const d = new Date();
      setFrom(toLocalYMD(new Date(d.getFullYear(), d.getMonth(), 1)));
      setTo(today);
    };
    return (
      <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-gray-500 mb-2">Khoảng ngày</div>
        <div className="flex flex-wrap gap-1 mb-3 text-xs">
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => { setFrom(today); setTo(today); }}>Hôm nay</button>
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => setRange(7)}>7 ngày</button>
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => setRange(30)}>30 ngày</button>
          <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={setMonth}>Tháng này</button>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-gray-500">Từ ngày:</label>
            <input type="date" className="input input-sm w-full"
              value={from} onChange={e => setFrom(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-[11px] text-gray-500">Đến ngày:</label>
            <input type="date" className="input input-sm w-full"
              value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        <div className="filter-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onApply(null)}>Xóa lọc</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            const f: ColFilter = { type: 'date' };
            if (from) f.from = from;
            if (to) f.to = to;
            if (f.from === undefined && f.to === undefined) onApply(null);
            else onApply(f);
          }}>
            <Check size={12} /> Áp dụng
          </button>
        </div>
      </div>
    );
  }

  // ===== TEXT FILTER (single input - search contains, lưu trong list selected) =====
  const initial = current?.type === 'list' && current.selected.size > 0
    ? Array.from(current.selected)[0] : '';
  const [text, setText] = useState(initial);
  return (
    <div ref={popupRef} className="filter-popup" onClick={e => e.stopPropagation()}>
      <div className="text-xs text-gray-500 mb-2">Chứa văn bản</div>
      <input className="input input-sm w-full" placeholder="Nhập để tìm..." value={text}
        onChange={e => setText(e.target.value)} autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (!text.trim()) onApply(null);
            else onApply({ type: 'list', selected: new Set([text.trim()]) });
          }
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="filter-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => onApply(null)}>Xóa lọc</button>
        <button className="btn btn-primary btn-sm" onClick={() => {
          if (!text.trim()) onApply(null);
          else onApply({ type: 'list', selected: new Set([text.trim()]) });
        }}>
          <Check size={12} /> Áp dụng
        </button>
      </div>
    </div>
  );
}
