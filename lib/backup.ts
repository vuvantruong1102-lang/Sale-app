'use client';

import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetchAll';

// ============================================================
// Sao lưu dữ liệu: xuất TOÀN BỘ (không giới hạn ngày) ra Excel/JSON.
// Dùng cho mục đích lưu trữ, đối soát, backup trước khi làm gì rủi ro.
// ============================================================

// Tên file có kèm ngày giờ để không ghi đè nhau.
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Tải một Blob xuống máy với tên file cho trước.
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Lấy toàn bộ dữ liệu cần sao lưu từ Supabase.
async function loadBackupData() {
  const supabase = createClient();

  // Đơn hàng: dùng fetchAll để vượt giới hạn 1000 dòng, lấy hết.
  const orders = await fetchAll(supabase as any, 'orders', {
    orderBy: 'date_order',
    ascending: false,
  });

  // Các bảng liên quan tới hóa đơn.
  const [invoices, invoiceStatus, misaOrders, externalInvoices] = await Promise.all([
    supabase.from('invoices').select('*'),
    supabase.from('invoice_status').select('*'),
    supabase.from('misa_orders').select('*'),
    supabase.from('external_invoices').select('*'),
  ]);

  return {
    orders,
    invoices: invoices.data || [],
    invoice_status: invoiceStatus.data || [],
    misa_orders: misaOrders.data || [],
    external_invoices: externalInvoices.data || [],
  };
}

// ---------- Xuất EXCEL ----------
// Mỗi nhóm dữ liệu là 1 sheet trong cùng 1 file .xlsx.
export async function exportBackupExcel() {
  const data = await loadBackupData();
  const wb = XLSX.utils.book_new();

  const addSheet = (rows: any[], name: string) => {
    // Tên sheet trong Excel tối đa 31 ký tự.
    const safeName = name.slice(0, 31);
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  };

  addSheet(data.orders, 'DonHang');
  addSheet(data.invoices, 'HoaDon');
  addSheet(data.invoice_status, 'TrangThaiHoaDon');
  addSheet(data.misa_orders, 'MISA');
  addSheet(data.external_invoices, 'HoaDonNgoai');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `saoluu_${stamp()}.xlsx`
  );

  return {
    orders: data.orders.length,
    invoices: data.invoices.length,
  };
}

// ---------- Xuất JSON ----------
// Một file .json chứa tất cả các bảng, kèm thời điểm xuất.
export async function exportBackupJSON() {
  const data = await loadBackupData();
  const payload = {
    exported_at: new Date().toISOString(),
    tables: data,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `saoluu_${stamp()}.json`
  );

  return {
    orders: data.orders.length,
    invoices: data.invoices.length,
  };
}
