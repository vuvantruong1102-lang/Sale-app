// Định dạng tiền VND (không có ký hiệu đ)
export const fmt = (n: number | null | undefined): string => {
  if (!n || isNaN(Number(n))) return '0';
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n)));
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
  // QUAN TRỌNG: Nếu chuỗi đã là ISO 8601 có timezone (chứa 'Z', '+HH:MM', '-HH:MM' ở cuối)
  // → để JS tự parse chuẩn UTC, KHÔNG dùng regex thủ công vì sẽ hiểu nhầm UTC thành local
  // Ví dụ: "2026-05-16T07:08:40+00:00" = 07:08 UTC = 14:08 VN, nếu parse bằng new Date(2026,4,16,7,8,40)
  // sẽ thành 07:08 VN (sai mất 7 tiếng).
  if (/T\d{2}:\d{2}/.test(str) && /([Zz]|[+-]\d{2}:?\d{2})$/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }
  // 2026-05-01 00:01 hoặc 2026-05-01T00:01:00 (không có timezone → coi là local time)
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})[\sT]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  // DD/MM/YYYY HH:MM:SS (giờ-phút-giây đều optional). Năm cho phép 2 hoặc 4 chữ số.
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    let yr = +m[3];
    if (yr < 100) yr += 2000; // "26" -> 2026
    return new Date(yr, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

export const fmtDate = (d: any): string => {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '';
  // Tự format dd/mm/yyyy HH:MM theo giờ LOCAL — KHÔNG dùng toLocaleDateString('vi-VN')
  // vì một số môi trường (Vercel server, browser locale khác) trả về kiểu Mỹ M/D/YYYY.
  const day = String(dt.getDate()).padStart(2, '0');
  const mon = String(dt.getMonth() + 1).padStart(2, '0');
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${day}/${mon}/${yr} ${hh}:${mi}`;
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
    // Parse "YYYY-MM-DD" theo LOCAL timezone (không phải UTC)
    // new Date("2026-04-01") sẽ là UTC midnight = 07:00 GMT+7 → sai
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const f = new Date(fy, fm - 1, fd, 0, 0, 0);
    const t = new Date(ty, tm - 1, td, 23, 59, 59, 999);
    return dt >= f && dt <= t;
  }
  return true;
};

export const norm = (s: any): string =>
  String(s ?? '').normalize('NFC').toLowerCase().trim();

// Tìm cột linh hoạt theo nhiều tên khả năng (xử lý Unicode NFD từ Shopee)
export function findCol(headers: string[], ...keys: string[]): string | null {
  // Exact match trước (đã normalize NFC)
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
  if (n.includes('hoàn thành') || n.includes('hoàn tất') || n.includes('complete')) return { text: 'Hoàn thành', color: 'green' };
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
