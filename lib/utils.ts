// Định dạng tiền VND
export const fmt = (n: number | null | undefined): string => {
  if (!n || isNaN(Number(n))) return '0₫';
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n))) + '₫';
};

export const fmtN = (n: number | null | undefined): string => {
  if (!n || isNaN(Number(n))) return '0';
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n)));
};

// Parse ngày từ nhiều format khác nhau
export const parseDate = (s: any): Date | null => {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  if (typeof s === 'number') {
    // Excel serial date
    const d = new Date((s - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(s).trim();
  // 2026-05-01 00:01 hoặc 2026-05-01T00:01:00
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})[\sT]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  // DD/MM/YYYY HH:MM
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(\d{2})?:?(\d{2})?/);
  if (m) {
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

export const fmtDate = (d: any): string => {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '';
  return dt.toLocaleDateString('vi-VN') + ' ' + dt.toTimeString().slice(0, 5);
};

export const dateKey = (d: any, grp: 'day' | 'month' | 'year'): string => {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '';
  if (grp === 'year') return dt.getFullYear() + '';
  if (grp === 'month') return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
};

export const inRange = (d: any, range: string, from?: string, to?: string): boolean => {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return false;
  const now = new Date();
  if (range === 'all') return true;
  if (range === 'today') return dt.toDateString() === now.toDateString();
  if (range === '7days') {
    const x = new Date(now); x.setDate(x.getDate() - 7); return dt >= x;
  }
  if (range === '30days') {
    const x = new Date(now); x.setDate(x.getDate() - 30); return dt >= x;
  }
  if (range === 'month') {
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
  }
  if (range === 'year') return dt.getFullYear() === now.getFullYear();
  if (range === 'custom' && from && to) {
    const f = new Date(from); const t = new Date(to); t.setHours(23, 59, 59, 999);
    return dt >= f && dt <= t;
  }
  return true;
};

export const norm = (s: any): string => String(s ?? '').toLowerCase().trim();

// Tìm cột linh hoạt theo nhiều tên khả năng
export function findCol(headers: string[], ...keys: string[]): string | null {
  // Exact match trước
  for (const k of keys) {
    const n = norm(k);
    const found = headers.find(h => norm(h) === n);
    if (found) return found;
  }
  // Then partial match
  for (const k of keys) {
    const n = norm(k);
    const found = headers.find(h => norm(h).includes(n));
    if (found) return found;
  }
  return null;
}

// Phân loại trạng thái đơn hàng -> tag ngắn + màu
export function shortStatus(s: string): { text: string; color: string } {
  const n = norm(s);
  if (n.includes('đã hủy') || n.includes('cancel')) return { text: 'Đã hủy', color: 'red' };
  if (n.includes('đang giao')) return { text: 'Đang giao', color: 'blue' };
  if (n.includes('chờ giao')) return { text: 'Chờ giao', color: 'yellow' };
  if (n.includes('người mua xác nhận')) return { text: 'Đã nhận', color: 'green' };
  if (n.includes('đã giao')) return { text: 'Đã giao', color: 'green' };
  if (n.includes('hoàn thành') || n.includes('complete')) return { text: 'Hoàn thành', color: 'green' };
  return { text: s || '-', color: 'gray' };
}

// Tag CSS class theo color
export function tagClass(color: string): string {
  const map: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
    shopee: 'bg-orange-100 text-orange-700',
    tiktok: 'bg-pink-100 text-pink-700',
  };
  return map[color] || map.gray;
}
