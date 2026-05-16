-- Thêm cột Số HĐ điều chỉnh (manual input, user tự nhập)
ALTER TABLE sales.invoice_status
  ADD COLUMN IF NOT EXISTS adjustment_invoice_no TEXT;
