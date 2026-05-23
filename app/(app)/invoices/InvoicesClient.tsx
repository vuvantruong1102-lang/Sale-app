'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Order } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { fmt, fmtDate, norm, shortStatus, tagClass, parseDate, inRange } from '@/lib/utils';
import { useResizableCols, ResizeHandle, ColDef } from '@/lib/useResizableCols';
import { fetchAll } from '@/lib/fetchAll';
import { ColHeader, ColFilter } from '@/components/ColHeader';
import {
  Upload, Download, ChevronLeft, ChevronRight, Search, RotateCcw, AlertTriangle,
} from 'lucide-react';

const PAGE_SIZE = 50;

type MisaOrder = {
  order_id: string;
  misa_order_no?: string;
  misa_date?: string | null;
  order_value?: number;
  invoice_export_value?: number;  // Giá trị đã xuất HĐ (cột I)
  export_status?: string;          // Tình trạng xuất HĐ (cột L)
  platform?: string;
  customer?: string;
};

type InvStatus = {
  order_id: string;
  invoice_no?: string;
  invoice_date?: string | null;
  invoice_value?: number;
  invoice_status?: string;         // Cột H trong file (giữ để tham khảo)
  release_status?: string;         // TT phát hành HĐ (cột K)
  invoice_type?: string;
};

const DEFAULT_COLS: ColDef[] = [
  { key: 'date',                width: 120, minWidth: 90 },
  { key: 'platform',            width: 80,  minWidth: 60 },
  { key: 'orderId',             width: 140, minWidth: 100 },
  { key: 'dateShip',            width: 120, minWidth: 90 },
  { key: 'status',              width: 105, minWidth: 70 },
  { key: 'product',             width: 260, minWidth: 120 },
  { key: 'sku',                 width: 95,  minWidth: 60 },
  { key: 'quantity',            width: 70,  minWidth: 50 },
  { key: 'price',               width: 100, minWidth: 80 },
  { key: 'orderValue',          width: 110, minWidth: 80 },
  { key: 'invoiceValue',        width: 120, minWidth: 90 },
  { key: 'exportStatus',        width: 140, minWidth: 110 },
  { key: 'releaseStatus',       width: 140, minWidth: 110 },
  { key: 'invoiceNo',           width: 130, minWidth: 100 },
  { key: 'warning',             width: 240, minWidth: 150 },
];

type Props = {
  initialOrders: Order[];
  initialMisa: MisaOrder[];
  initialInvStatus: InvStatus[];
  initialExternal?: { order_id: string | null }[];
};

export default function InvoicesClient({ initialOrders, initialMisa, initialInvStatus, initialExternal = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [orders] = useState<Order[]>(initialOrders);
  const [misa, setMisa] = useState<MisaOrder[]>(initialMisa);
  const [invStatus, setInvStatus] = useState<InvStatus[]>(initialInvStatus);

  const [dateRange, setDateRange] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'shipped' | 'warning'>('all');
  const [page, setPage] = useState(1);
  const [importingMisa, setImportingMisa] = useState(false);
  const [importingStatus, setImportingStatus] = useState(false);
  const [alert, setAlert] = useState<{ type: string; text: string } | null>(null);
  const misaFileRef = useRef<HTMLInputElement>(null);
  const statusFileRef = useRef<HTMLInputElement>(null);

  // Per-column filters (giống trang Đơn hàng) — dùng shared component
  // Text filter lưu vào 'list' với selected có 1 phần tử
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  const { cols, setWidth, reset } = useResizableCols('invoices-col-widths', DEFAULT_COLS);
  const colW = (k: string) => cols.find(c => c.key === k)?.width || 100;

  // Map order_id -> misa & invoice status
  const misaMap = useMemo(() => {
    const m = new Map<string, MisaOrder>();
    misa.forEach(r => m.set(r.order_id, r));
    return m;
  }, [misa]);

  const statusMap = useMemo(() => {
    const m = new Map<string, InvStatus>();
    invStatus.forEach(r => m.set(r.order_id, r));
    return m;
  }, [invStatus]);

  // Set order_id có "Hóa đơn ngoài" (khách yêu cầu xuất HĐ theo thông tin công ty)
  const externalOrderIds = useMemo(() => {
    const s = new Set<string>();
    initialExternal.forEach(e => { if (e.order_id) s.add(String(e.order_id).trim()); });
    return s;
  }, [initialExternal]);

  // Tính trạng thái xuất HĐ + cảnh báo cho mỗi đơn
  const rowsWithCalc = useMemo(() => {
    // Group orders theo order_id, tính tổng giá trị đơn (vì 1 đơn có thể nhiều dòng SKU)
    // Chỉ giữ dòng chính (total_paid cao nhất) để hiển thị, nhưng tổng giá trị tính tất cả
    const grouped = new Map<string, Order[]>();
    orders.forEach(o => {
      const arr = grouped.get(o.order_id) || [];
      arr.push(o);
      grouped.set(o.order_id, arr);
    });

    const rows: any[] = [];
    grouped.forEach((lines, oid) => {
      // Dòng chính = total_paid cao nhất
      let main = lines[0];
      for (const l of lines) {
        if ((l.total_paid || 0) > (main.total_paid || 0)) main = l;
      }

      // Tổng giá trị đơn = SUM của (price_deal × qty) - shop_voucher
      // shop_voucher chỉ tính 1 lần ở cấp đơn (lấy từ dòng chính)
      let totalQty = 0;
      let sumPriceQty = 0;
      lines.forEach(l => {
        totalQty += l.quantity || 1;
        sumPriceQty += (l.price_deal || 0) * (l.quantity || 1);
      });
      const orderValue = sumPriceQty - (main.shop_voucher || 0);

      const st = shortStatus(main.status || '');
      const hasShipped = !!main.date_ship;
      const isCancelled = st.text === 'Đã hủy';
      const isPendingShip = st.text === 'Chờ giao'; // đơn chưa thực sự giao xong

      const misaRec = misaMap.get(oid);
      const statusRec = statusMap.get(oid);

      // Giá trị xuất HĐ = cột D "Giá trị hóa đơn" trong file Hoa_don (invoice_status)
      // Fallback: file MISA (misa_orders.invoice_export_value)
      const invoiceValue = statusRec?.invoice_value ?? misaRec?.invoice_export_value ?? null;
      // Trạng thái xuất HĐ = cột L "Tình trạng xuất hóa đơn" trong file MISA
      const exportStatusText = misaRec?.export_status ?? null;
      // TT phát hành HĐ = cột K "TT phát hành hóa đơn" trong file Hoa_don
      const releaseStatusText = statusRec?.release_status ?? null;

      // Cờ tiện ích dùng cho các cảnh báo bên dưới
      const daXuatHD = norm(exportStatusText).includes('đã xuất'); // cột L = "Đã xuất hóa đơn"
      const hdChuaPhatHanh = norm(releaseStatusText).includes('chưa phát hành'); // cột K = "Chưa phát hành"
      const hdDaCapMa = norm(releaseStatusText).includes('đã cấp mã') || norm(releaseStatusText).includes('đã phát hành'); // cột K

      // ============ TÍNH "TRẠNG THÁI XUẤT HĐ" (cột visible) ============
      // Cột này phản ánh TÌNH TRẠNG XUẤT HÓA ĐƠN (cột L file MISA), KHÔNG phải
      // trạng thái giao hàng. Vì vậy ưu tiên cột L trước; chỉ khi đơn không có
      // dữ liệu MISA mới suy ra theo trạng thái giao hàng.
      let statusFinal: { text: string; color: string };
      if (exportStatusText) {
        // Có cột L "Tình trạng xuất hóa đơn" từ file MISA → hiển thị nguyên văn
        const s = norm(exportStatusText);
        const color = s.includes('đã xuất') ? 'green' : (s.includes('chưa xuất') ? 'red' : 'yellow');
        statusFinal = { text: exportStatusText, color };
      } else if (misaRec) {
        // Có bản ghi MISA nhưng cột L trống → coi như đã xuất
        statusFinal = { text: 'Đã xuất', color: 'green' };
      } else if (isCancelled) {
        statusFinal = { text: 'Đơn đã hủy', color: 'gray' };
      } else if (!hasShipped) {
        statusFinal = { text: 'Chưa gửi hàng', color: 'gray' };
      } else {
        statusFinal = { text: 'Chưa xuất HĐ', color: 'red' };
      }

      // ============ CẢNH BÁO ============
      const warnings: string[] = [];

      // Cả 2 cột "Trạng thái xuất HĐ" và "TT phát hành HĐ" là N/A (không có dữ liệu MISA lẫn HĐ)
      const isNA = !misaRec && !statusRec;

      // Đơn có trong "Hóa đơn ngoài" → khách yêu cầu xuất HĐ theo thông tin công ty
      if (externalOrderIds.has(String(oid).trim())) {
        warnings.push('Xuất HĐ theo thông tin KH');
      }

      if (isNA) {
        // Cả 2 cột N/A: đơn hủy thì không cảnh báo; đơn khác nhắc kiểm tra MISA
        if (!isCancelled) {
          warnings.push('Kiểm tra cập nhật MISA');
        }
      } else {
        // Đơn đã gửi hàng nhưng chưa xuất HĐ — bỏ qua nếu đơn còn "Chờ giao" (chưa giao xong)
        if (hasShipped && !isPendingShip && !isCancelled && !misaRec) {
          warnings.push('Chưa xuất HĐ (đã gửi hàng)');
        }
      }

      // Sai giá trị xuất HĐ (so sánh với Giá trị ĐH) — chỉ khi đã thực sự xuất HĐ
      if (misaRec && daXuatHD && invoiceValue !== null && Math.abs(invoiceValue - orderValue) > 0.5) {
        warnings.push(`Giá trị HĐ sai: HĐ ${fmt(invoiceValue)} ≠ ĐH ${fmt(orderValue)}`);
      }

      // Đơn đã hủy nhưng đã xuất HĐ — nội dung cảnh báo theo TT phát hành HĐ
      if (isCancelled && misaRec && daXuatHD) {
        if (hdChuaPhatHanh) {
          warnings.push('Đơn hủy, không phát hành hóa đơn');
        } else if (hdDaCapMa) {
          warnings.push('Đơn hủy, cần hủy hóa đơn');
        } else {
          warnings.push('Đơn hủy nhưng đã xuất HĐ — cần hủy HĐ');
        }
      }

      // Đơn chưa gửi hàng nhưng đã xuất HĐ — bỏ qua nếu HĐ chưa phát hành (chưa có hiệu lực)
      if (!hasShipped && !isCancelled && misaRec && daXuatHD && !hdChuaPhatHanh) {
        warnings.push('Chưa gửi hàng nhưng đã xuất HĐ');
      }

      // Đơn "Chờ giao" + đã xuất HĐ + HĐ chưa phát hành
      if (isPendingShip && !isCancelled && misaRec && daXuatHD && hdChuaPhatHanh) {
        warnings.push('Đơn chưa giao, chưa phát hành HĐ');
      }

      // TT phát hành HĐ — cảnh báo các bất thường (KHÔNG cảnh báo "chưa phát hành")
      if (misaRec && daXuatHD) {
        if (!statusRec) {
          warnings.push('Đã xuất HĐ nhưng thiếu dữ liệu trạng thái phát hành');
        } else {
          const rs = norm(releaseStatusText);
          if (rs.includes('hủy')) {
            warnings.push('HĐ đã hủy');
          } else if (!rs.includes('đã phát hành') && !rs.includes('đã cấp mã')
                     && !rs.includes('chưa phát hành') && rs !== '') {
            warnings.push(`TT phát hành bất thường: ${releaseStatusText}`);
          }
        }
      }

      // Sai giá trị giữa file Hóa đơn và file MISA
      if (statusRec && misaRec && invoiceValue !== null
          && Math.abs((statusRec.invoice_value || 0) - invoiceValue) > 0.5) {
        warnings.push('Giá trị 2 file MISA khác nhau');
      }

      rows.push({
        o: main,
        lines,
        totalQty,
        orderValue,
        price: main.price_deal || 0,
        dateShip: main.date_ship,
        statusText: st.text,
        statusColor: st.color,
        invoiceValue,
        exportStatusText,
        releaseStatusText,
        statusFinal,
        warnings,
        misaRec,
        statusRec,
        hasShipped,
        isCancelled,
        invoiceNo: statusRec?.invoice_no || '',
      });
    });
    return rows;
  }, [orders, misaMap, statusMap, externalOrderIds]);

  // Stats
  const stats = useMemo(() => {
    const total = rowsWithCalc.length;
    const issued = rowsWithCalc.filter(r => norm(r.statusFinal.text).includes('đã xuất')).length;
    const missing = rowsWithCalc.filter(r => {
      const s = norm(r.statusFinal.text);
      return s.includes('chưa xuất');
    }).length;
    const warnings = rowsWithCalc.filter(r => r.warnings.length > 0).length;
    return { total, issued, missing, warnings };
  }, [rowsWithCalc]);

  // Unique values cho list filter
  const uniqueValues = useMemo(() => {
    const platforms = new Set<string>();
    const statuses = new Set<string>();
    const skus = new Set<string>();
    const exportStatuses = new Set<string>();
    const releaseStatuses = new Set<string>();
    rowsWithCalc.forEach(r => {
      platforms.add(r.o.platform === 'shopee' ? 'Shopee' : 'TikTok');
      statuses.add(r.statusText);
      skus.add(r.o.sku || '(trống)');
      exportStatuses.add(r.statusFinal.text);
      releaseStatuses.add(r.releaseStatusText || '(trống)');
    });
    return { platforms, statuses, skus, exportStatuses, releaseStatuses };
  }, [rowsWithCalc]);

  // Filter
  const filtered = useMemo(() => {
    let list = rowsWithCalc;

    if (dateRange !== 'all') {
      list = list.filter(r => inRange(r.o.date_order, dateRange, dateFrom, dateTo));
    }

    if (filterMode === 'shipped') {
      list = list.filter(r => r.hasShipped && !r.isCancelled);
    } else if (filterMode === 'warning') {
      list = list.filter(r => r.warnings.length > 0);
    }

    const q = norm(search);
    if (q) {
      list = list.filter(r =>
        norm(r.o.order_id).includes(q) || norm(r.o.product_name).includes(q) || norm(r.o.sku).includes(q)
      );
    }

    // Per-column filters
    const cf = colFilters;
    if (Object.keys(cf).length > 0) {
      const matchList = (key: string, val: string) => {
        const f = cf[key];
        if (!f || f.type !== 'list' || f.selected.size === 0) return true;
        return f.selected.has(val || '(trống)');
      };
      const matchNum = (key: string, val: number) => {
        const f = cf[key];
        if (!f || f.type !== 'number') return true;
        if (f.min !== undefined && val < f.min) return false;
        if (f.max !== undefined && val > f.max) return false;
        return true;
      };
      const matchText = (key: string, val: string) => {
        const f = cf[key];
        if (!f || f.type !== 'list' || f.selected.size === 0) return true;
        // Text filter lưu trong list với 1 phần tử
        const q = Array.from(f.selected)[0];
        return norm(val).includes(norm(q));
      };
      const matchDate = (key: string, dateStr: string | null | undefined) => {
        const f = cf[key];
        if (!f || f.type !== 'date') return true;
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const ymd = `${y}-${m}-${day}`;
        if (f.from && ymd < f.from) return false;
        if (f.to && ymd > f.to) return false;
        return true;
      };

      list = list.filter(r => {
        if (!matchDate('date', r.o.date_order)) return false;
        if (!matchList('platform', r.o.platform === 'shopee' ? 'Shopee' : 'TikTok')) return false;
        if (!matchText('orderId', r.o.order_id)) return false;
        if (!matchList('status', r.statusText)) return false;
        if (!matchText('product', r.o.product_name || '')) return false;
        if (!matchList('sku', r.o.sku || '(trống)')) return false;
        if (!matchNum('quantity', r.totalQty)) return false;
        if (!matchNum('price', r.price)) return false;
        if (!matchNum('orderValue', r.orderValue)) return false;
        if (!matchDate('dateShip', r.dateShip)) return false;
        if (!matchNum('invoiceValue', r.invoiceValue || 0)) return false;
        if (!matchList('exportStatus', r.statusFinal.text)) return false;
        if (!matchText('invoiceNo', r.invoiceNo)) return false;
        if (!matchList('releaseStatus', r.releaseStatusText || '(trống)')) return false;
        return true;
      });
    }

    return list;
  }, [rowsWithCalc, dateRange, dateFrom, dateTo, search, filterMode, colFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ============ IMPORT FILE MISA (XUẤT HĐ) ============
  const handleImportMisa = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportingMisa(true);
    setAlert(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      const payload: any[] = [];
      const toIso = (v: any) => { const d = parseDate(v); return d ? d.toISOString() : null; };

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const allRows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });

        // Tìm dòng header (chứa "Số đơn hàng từ hệ thống khác")
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(15, allRows.length); i++) {
          const row = allRows[i] || [];
          if (row.some(c => norm(c).includes('số đơn hàng từ hệ thống khác'))) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" không có cột "Số đơn hàng từ hệ thống khác"` });
          continue;
        }
        const headers = (allRows[headerRowIdx] || []).map((h: any) => String(h ?? '').trim());
        const idx = (key: string) => headers.findIndex(h => norm(h) === norm(key));
        const c_date = idx('Ngày đơn hàng');
        const c_misaNo = idx('Số đơn hàng');
        const c_platform = idx('Sàn thương mại điện tử');
        const c_orderId = idx('Số đơn hàng từ hệ thống khác');
        const c_ghi = idx('Tình trạng ghi doanh số');
        const c_customer = idx('Khách hàng');
        const c_value = idx('Giá trị đơn hàng');                    // Cột H
        const c_invoiceExport = idx('Giá trị đã xuất hóa đơn');     // Cột I
        const c_exportStatus = idx('Tình trạng xuất hóa đơn');      // Cột L

        if (c_orderId === -1 || c_value === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" thiếu cột cần thiết` });
          continue;
        }

        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
          const row = allRows[i] || [];
          const orderId = String(row[c_orderId] ?? '').trim();
          if (!orderId) continue;
          payload.push({
            user_id: user.id,
            order_id: orderId,
            misa_order_no: c_misaNo >= 0 ? String(row[c_misaNo] ?? '').trim() : '',
            misa_date: c_date >= 0 ? toIso(row[c_date]) : null,
            platform: c_platform >= 0 ? String(row[c_platform] ?? '').trim() : '',
            customer: c_customer >= 0 ? String(row[c_customer] ?? '').trim() : '',
            order_value: +(row[c_value] || 0),
            invoice_export_value: c_invoiceExport >= 0 ? +(row[c_invoiceExport] || 0) : 0,
            export_status: c_exportStatus >= 0 ? String(row[c_exportStatus] ?? '').trim() : '',
            ghi_doanh_so: c_ghi >= 0 ? String(row[c_ghi] ?? '').trim() : '',
          });
        }
      }

      if (payload.length === 0) {
        setAlert({ type: 'error', text: 'Không có dữ liệu hợp lệ trong file' });
        return;
      }

      // Debug: kiểm tra cột invoice_export_value có giá trị thật không
      const withExport = payload.filter(p => p.invoice_export_value > 0).length;
      const withStatus = payload.filter(p => p.export_status).length;

      // ===== Thay thế theo khoảng thời gian của file mới =====
      // Cộng dồn nhiều kỳ: chỉ làm mới các đơn NẰM TRONG khoảng ngày của file vừa up.
      // Đơn cũ trong khoảng nhưng KHÔNG còn trong file mới sẽ bị xóa → hiển thị N/A.
      // Đơn thuộc kỳ khác (ngoài khoảng) được giữ nguyên.
      const fileDates = payload.map(p => p.misa_date).filter(Boolean).sort();
      const minDate = fileDates[0] || null;
      const maxDate = fileDates[fileDates.length - 1] || null;

      if (minDate && maxDate) {
        // Xóa các đơn cũ trong khoảng [minDate, maxDate] (sẽ được nạp lại từ file mới)
        const { error: delErr } = await supabase
          .from('misa_orders')
          .delete()
          .eq('user_id', user.id)
          .gte('misa_date', minDate)
          .lte('misa_date', maxDate);
        if (delErr) throw delErr;

        // Dọn các bản ghi cũ KHÔNG có ngày (misa_date null) — dữ liệu lỗi từ lần import cũ,
        // range-delete theo ngày không với tới được. Chỉ xóa nếu đơn đó không có trong file mới.
        const newIds = new Set(payload.map(p => p.order_id));
        const { data: nullRows } = await supabase
          .from('misa_orders')
          .select('id, order_id')
          .eq('user_id', user.id)
          .is('misa_date', null);
        const orphanIds = (nullRows || [])
          .filter(r => !newIds.has(r.order_id))
          .map(r => r.id);
        if (orphanIds.length > 0) {
          const { error: delNullErr } = await supabase
            .from('misa_orders')
            .delete()
            .in('id', orphanIds);
          if (delNullErr) throw delNullErr;
        }
      }

      const BATCH = 500;
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase
          .from('misa_orders')
          .upsert(slice, { onConflict: 'user_id,order_id', ignoreDuplicates: false });
        if (error) throw error;
      }

      setAlert({
        type: 'success',
        text: `✓ Đã import ${payload.length} đơn xuất HĐ từ MISA • Có ${withExport} đơn có Giá trị xuất HĐ • ${withStatus} đơn có Trạng thái xuất HĐ`,
      });

      const fresh = await fetchAll(supabase as any, 'misa_orders', { orderBy: null });
      setMisa(fresh);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImportingMisa(false);
      if (misaFileRef.current) misaFileRef.current.value = '';
    }
  };

  // ============ IMPORT FILE TRẠNG THÁI HĐ ============
  const handleImportStatus = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportingStatus(true);
    setAlert(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');

      const payload: any[] = [];
      const toIso = (v: any) => { const d = parseDate(v); return d ? d.toISOString() : null; };

      for (const f of files) {
        const data = await f.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const allRows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });

        // Tìm dòng header (chứa "Số đơn hàng từ hệ thống khác")
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(15, allRows.length); i++) {
          const row = allRows[i] || [];
          if (row.some(c => norm(c).includes('số đơn hàng từ hệ thống khác'))) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" không có cột "Số đơn hàng từ hệ thống khác"` });
          continue;
        }
        const headers = (allRows[headerRowIdx] || []).map((h: any) => String(h ?? '').trim());
        const idx = (key: string) => headers.findIndex(h => norm(h) === norm(key));
        const c_date = idx('Ngày hóa đơn');
        const c_no = idx('Số hóa đơn');
        const c_value = idx('Giá trị hóa đơn');
        const c_platform = idx('Sàn thương mại điện tử');
        const c_orderId = idx('Số đơn hàng từ hệ thống khác');
        const c_type = idx('Loại');
        const c_status = idx('Trạng thái hóa đơn');            // Cột H
        const c_release = idx('TT phát hành hóa đơn');          // Cột K

        if (c_orderId === -1) {
          setAlert({ type: 'error', text: `File "${f.name}" thiếu cột Số đơn hàng từ hệ thống khác` });
          continue;
        }

        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
          const row = allRows[i] || [];
          const orderId = String(row[c_orderId] ?? '').trim();
          if (!orderId) continue;
          // Parse số có dấu phẩy + space, vd "349,000 " → 349000
          const parseNum = (v: any): number => {
            if (v === null || v === undefined || v === '') return 0;
            const cleaned = String(v).replace(/,/g, '').trim();
            const n = Number(cleaned);
            return isNaN(n) ? 0 : n;
          };
          payload.push({
            user_id: user.id,
            order_id: orderId,
            invoice_no: c_no >= 0 ? String(row[c_no] ?? '').trim() : '',
            invoice_date: c_date >= 0 ? toIso(row[c_date]) : null,
            invoice_value: c_value >= 0 ? parseNum(row[c_value]) : 0,
            platform: c_platform >= 0 ? String(row[c_platform] ?? '').trim() : '',
            invoice_type: c_type >= 0 ? String(row[c_type] ?? '').trim() : '',
            invoice_status: c_status >= 0 ? String(row[c_status] ?? '').trim() : '',
            release_status: c_release >= 0 ? String(row[c_release] ?? '').trim() : '',
          });
        }
      }

      if (payload.length === 0) {
        setAlert({ type: 'error', text: 'Không có dữ liệu hợp lệ trong file' });
        return;
      }

      const withRelease = payload.filter(p => p.release_status).length;

      // ===== Thay thế theo khoảng thời gian của file mới (giống import MISA) =====
      // Đơn cũ trong khoảng [minDate, maxDate] mà không còn trong file mới sẽ bị xóa → N/A.
      // Đơn thuộc kỳ khác (ngoài khoảng) được giữ nguyên.
      const fileDates = payload.map(p => p.invoice_date).filter(Boolean).sort();
      const minDate = fileDates[0] || null;
      const maxDate = fileDates[fileDates.length - 1] || null;

      if (minDate && maxDate) {
        const { error: delErr } = await supabase
          .from('invoice_status')
          .delete()
          .eq('user_id', user.id)
          .gte('invoice_date', minDate)
          .lte('invoice_date', maxDate);
        if (delErr) throw delErr;

        // Dọn các bản ghi cũ không có ngày (invoice_date null) không còn trong file mới
        const newIds = new Set(payload.map(p => p.order_id));
        const { data: nullRows } = await supabase
          .from('invoice_status')
          .select('id, order_id')
          .eq('user_id', user.id)
          .is('invoice_date', null);
        const orphanIds = (nullRows || [])
          .filter(r => !newIds.has(r.order_id))
          .map(r => r.id);
        if (orphanIds.length > 0) {
          const { error: delNullErr } = await supabase
            .from('invoice_status')
            .delete()
            .in('id', orphanIds);
          if (delNullErr) throw delNullErr;
        }
      }

      const BATCH = 500;
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase
          .from('invoice_status')
          .upsert(slice, { onConflict: 'user_id,order_id', ignoreDuplicates: false });
        if (error) throw error;
      }

      setAlert({
        type: 'success',
        text: `✓ Đã import ${payload.length} trạng thái HĐ • ${withRelease} đơn có TT phát hành HĐ`,
      });

      const fresh = await fetchAll(supabase as any, 'invoice_status', { orderBy: null });
      setInvStatus(fresh);
      router.refresh();
    } catch (err: any) {
      setAlert({ type: 'error', text: 'Lỗi: ' + (err.message || err) });
    } finally {
      setImportingStatus(false);
      if (statusFileRef.current) statusFileRef.current.value = '';
    }
  };

  const handleExport = () => {
    if (!filtered.length) { window.alert('Không có dữ liệu'); return; }
    const rows = filtered.map(r => ({
      'Ngày đặt': r.o.date_order,
      'Sàn': r.o.platform,
      'Mã đơn': r.o.order_id,
      'Ngày gửi hàng': r.dateShip || '',
      'Trạng thái': r.o.status,
      'Sản phẩm': r.o.product_name,
      'SKU': r.o.sku,
      'Số lượng': r.totalQty,
      'Giá bán': r.price,
      'Giá trị ĐH': r.orderValue,
      'Giá trị xuất HĐ': r.invoiceValue ?? '',
      'Trạng thái xuất HĐ': r.statusFinal.text,
      'TT phát hành HĐ': r.releaseStatusText || '',
      'Số HĐ': r.invoiceNo || '',
      'Cảnh báo': r.warnings.join('; '),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hóa đơn');
    XLSX.writeFile(wb, 'hoa-don-' + Date.now() + '.xlsx');
  };

  return (
    <div className="fade-in w-full">
      <h1 className="text-2xl font-bold mb-1">Hóa đơn</h1>
      <p className="text-sm text-gray-500 mb-5">
        Kiểm tra MISA đã xuất HĐ đúng và đầy đủ chưa — đơn đã gửi hàng phải có HĐ với giá trị đúng
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input ref={misaFileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImportMisa} />
        <button className="btn btn-primary" disabled={importingMisa} onClick={() => misaFileRef.current?.click()}>
          <Upload size={15} /> {importingMisa ? 'Đang import...' : 'Import file Xuất HĐ (MISA)'}
        </button>

        <input ref={statusFileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImportStatus} />
        <button
          className="btn"
          style={{ background: '#8b5cf6', color: 'white' }}
          disabled={importingStatus}
          onClick={() => statusFileRef.current?.click()}
        >
          <Upload size={15} /> {importingStatus ? 'Đang import...' : 'Import file Trạng thái HĐ'}
        </button>

        <select className="input" value={dateRange} onChange={e => { setDateRange(e.target.value); setPage(1); }}>
          <option value="all">Tất cả thời gian</option>
          <option value="today">Hôm nay</option>
          <option value="7days">7 ngày qua</option>
          <option value="30days">30 ngày qua</option>
          <option value="month">Tháng này</option>
          <option value="year">Năm này</option>
          <option value="custom">Tùy chọn...</option>
        </select>
        {dateRange === 'custom' && (
          <>
            <input type="date" className="input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
            <span className="text-gray-400 text-sm">đến</span>
            <input type="date" className="input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
          </>
        )}

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-56" placeholder="Tìm mã đơn, SP, SKU..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={14} /> Xuất Excel
        </button>
        <button className="btn btn-secondary btn-sm" onClick={reset}>
          <RotateCcw size={13} /> Reset cột
        </button>
      </div>

      {alert && (
        <div className={`mb-4 px-4 py-3 rounded-md text-sm ${
          alert.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          alert.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>{alert.text}</div>
      )}

      {/* KPI cards / filter pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <button
          onClick={() => { setFilterMode('all'); setPage(1); }}
          className={`card text-left transition cursor-pointer ${filterMode === 'all' ? 'ring-2 ring-brand-500' : 'hover:bg-gray-50'}`}
        >
          <div className="text-xs text-gray-500 uppercase tracking-wider">Tổng đơn</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </button>
        <button
          onClick={() => { setFilterMode('shipped'); setPage(1); }}
          className={`card text-left transition cursor-pointer ${filterMode === 'shipped' ? 'ring-2 ring-brand-500' : 'hover:bg-gray-50'}`}
        >
          <div className="text-xs text-gray-500 uppercase tracking-wider">Đã xuất HĐ</div>
          <div className="text-2xl font-bold mt-1 text-green-600">{stats.issued}</div>
        </button>
        <button
          onClick={() => { setFilterMode('warning'); setPage(1); }}
          className={`card text-left transition cursor-pointer ${filterMode === 'warning' ? 'ring-2 ring-brand-500' : 'hover:bg-gray-50'}`}
        >
          <div className="text-xs text-gray-500 uppercase tracking-wider">Chưa xuất HĐ</div>
          <div className="text-2xl font-bold mt-1 text-red-600">{stats.missing}</div>
        </button>
        <button
          onClick={() => { setFilterMode('warning'); setPage(1); }}
          className={`card text-left transition cursor-pointer ${filterMode === 'warning' ? 'ring-2 ring-brand-500' : 'hover:bg-gray-50'}`}
        >
          <div className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle size={12} /> Cảnh báo
          </div>
          <div className="text-2xl font-bold mt-1 text-yellow-600">{stats.warnings}</div>
        </button>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="tbl orders-tbl" style={{ width: cols.reduce((s, c) => s + c.width, 0) }}>
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead><tr>
            <ColHeader label="Ngày đặt" colKey="date" width={colW('date')} onResize={w => setWidth('date', w)}
              filterable filterType="date"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Sàn" colKey="platform" width={colW('platform')} onResize={w => setWidth('platform', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.platforms)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Mã đơn" colKey="orderId" width={colW('orderId')} onResize={w => setWidth('orderId', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Ngày gửi" colKey="dateShip" width={colW('dateShip')} onResize={w => setWidth('dateShip', w)}
              filterable filterType="date"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Trạng thái" colKey="status" width={colW('status')} onResize={w => setWidth('status', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.statuses)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Sản phẩm" colKey="product" width={colW('product')} onResize={w => setWidth('product', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="SKU" colKey="sku" width={colW('sku')} onResize={w => setWidth('sku', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.skus)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="SL" colKey="quantity" width={colW('quantity')} onResize={w => setWidth('quantity', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá bán" colKey="price" width={colW('price')} onResize={w => setWidth('price', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá trị ĐH" colKey="orderValue" width={colW('orderValue')} onResize={w => setWidth('orderValue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Giá trị xuất HĐ" colKey="invoiceValue" width={colW('invoiceValue')} onResize={w => setWidth('invoiceValue', w)} align="right"
              filterable filterType="number"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Trạng thái xuất HĐ" colKey="exportStatus" width={colW('exportStatus')} onResize={w => setWidth('exportStatus', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.exportStatuses)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="TT phát hành HĐ" colKey="releaseStatus" width={colW('releaseStatus')} onResize={w => setWidth('releaseStatus', w)}
              filterable filterType="list" filterValues={Array.from(uniqueValues.releaseStatuses)}
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <ColHeader label="Số HĐ" colKey="invoiceNo" width={colW('invoiceNo')} onResize={w => setWidth('invoiceNo', w)}
              filterable filterType="text"
              filters={colFilters} setFilters={setColFilters} open={openFilter} setOpen={setOpenFilter} onPageChange={() => setPage(1)} />
            <th>Cảnh báo</th>
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={15} className="text-center text-gray-400 py-12">
                Không có dữ liệu
              </td></tr>
            )}
            {pageRows.map(r => {
              const o = r.o;
              return (
                <tr key={o.unique_key} className={r.warnings.length > 0 ? 'bg-yellow-50/50' : ''}>
                  <td className="text-xs">{fmtDate(o.date_order)}</td>
                  <td><span className={`tag ${tagClass(o.platform)}`}>{o.platform === 'shopee' ? 'Shopee' : 'TikTok'}</span></td>
                  <td className="font-medium text-xs">{o.order_id}</td>
                  <td className="text-xs">{r.dateShip ? fmtDate(r.dateShip) : <span className="text-gray-300">—</span>}</td>
                  <td><span className={`tag ${tagClass(r.statusColor)}`}>{r.statusText}</span></td>
                  <td>
                    <div className="truncate" title={o.product_name}>{o.product_name || '-'}</div>
                  </td>
                  <td className="text-xs">{o.sku || '-'}</td>
                  <td className="text-right">{r.totalQty}</td>
                  <td className="text-right">{fmt(r.price)}</td>
                  <td className="text-right font-medium">{fmt(r.orderValue)}</td>
                  <td className="text-right">
                    {r.invoiceValue !== null
                      ? <span className={`font-medium ${Math.abs(r.invoiceValue - r.orderValue) > 0.5 ? 'text-red-600' : ''}`}>{fmt(r.invoiceValue)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td>
                    {r.misaRec
                      ? <span className={`tag ${tagClass(r.statusFinal.color)}`}>{r.statusFinal.text}</span>
                      : <span className="text-gray-400">N/A</span>}
                  </td>
                  <td>
                    {!r.statusRec
                      ? <span className="text-gray-400">N/A</span>
                      : r.releaseStatusText
                      ? <span className={`tag ${
                          norm(r.releaseStatusText).includes('đã phát hành') || norm(r.releaseStatusText).includes('đã cấp mã')
                            ? 'bg-green-100 text-green-700'
                            : norm(r.releaseStatusText).includes('hủy')
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>{r.releaseStatusText}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-xs font-mono">
                    {r.invoiceNo || <span className="text-gray-300">—</span>}
                  </td>
                  <td>
                    {r.warnings.length === 0
                      ? <span className="text-gray-300">—</span>
                      : (
                        <div className="flex flex-col gap-0.5">
                          {r.warnings.map((w: string, i: number) => (
                            <span key={i} className="text-xs text-red-600 flex items-start gap-1">
                              <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> {w}
                            </span>
                          ))}
                        </div>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-500">{filtered.length.toLocaleString('vi-VN')} đơn</div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <ChevronLeft size={14} /> Trước
          </button>
          <span className="text-sm text-gray-500">Trang {page}/{totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Sau <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
