-- ============================================================
-- BẢNG "HÓA ĐƠN NGOÀI" (external_invoices)
-- Dùng cho 2 mục đích:
--  1. Khách trên sàn yêu cầu xuất HĐ theo thông tin công ty
--     (nhập order_id để link tới đơn sàn → hiện cảnh báo ở panel Hóa đơn)
--  2. Đơn hàng NGOÀI sàn cần kế toán xuất HĐ (order_id để trống)
-- Mỗi bản ghi = 1 đơn, có thể chứa NHIỀU mặt hàng (lưu dạng JSON trong cột items)
-- ============================================================

CREATE TABLE IF NOT EXISTS sales.external_invoices (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  order_id TEXT,                       -- Mã đơn sàn (KHÔNG bắt buộc; nếu khớp đơn sàn sẽ hiện cảnh báo)

  -- Thông tin công ty xuất HĐ
  company_name TEXT NOT NULL,          -- Tên công ty
  tax_code TEXT,                       -- Mã số thuế
  address TEXT,                        -- Địa chỉ
  email TEXT,                          -- Email nhận hóa đơn

  -- Danh sách mặt hàng: [{ code, name, qty, amount }]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC DEFAULT 0,      -- Tổng thành tiền (tính từ items)

  note TEXT,                           -- Ghi chú thêm (tùy chọn)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extinv_user ON sales.external_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_extinv_order ON sales.external_invoices(user_id, order_id);

ALTER TABLE sales.external_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "external_invoices_all_own" ON sales.external_invoices;
CREATE POLICY "external_invoices_all_own" ON sales.external_invoices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
