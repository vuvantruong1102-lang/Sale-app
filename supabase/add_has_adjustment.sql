-- ============================================================
-- ALTER bảng reconciliation: thêm cột has_adjustment
-- Đánh dấu đơn có giao dịch "Cấn trừ Số dư TK Shopee" hoặc "Điều chỉnh"
-- để phát hiện đơn THHT (Trả hàng/Hoàn tiền)
-- Chạy SQL này 1 lần trong Supabase SQL Editor
-- ============================================================

ALTER TABLE sales.reconciliation
  ADD COLUMN IF NOT EXISTS has_adjustment BOOLEAN DEFAULT FALSE;
