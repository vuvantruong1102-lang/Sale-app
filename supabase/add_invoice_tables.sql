-- ============================================================
-- 2 BẢNG MỚI CHO PANEL HÓA ĐƠN
-- - misa_orders: đơn xuất HĐ (từ file MISA Đơn đặt hàng)
-- - invoice_status: trạng thái HĐ (từ file Hóa đơn)
-- Cả 2 link tới đơn hàng qua mã đơn Shopee/TikTok
-- ============================================================

-- 1. MISA ORDERS - bản ghi từ file MISA xuất HĐ
CREATE TABLE IF NOT EXISTS sales.misa_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  order_id TEXT NOT NULL,            -- Mã đơn Shopee/TikTok (cột E)
  misa_order_no TEXT,                -- Số đơn hàng MISA (cột C, vd ĐH03960)
  misa_date TIMESTAMPTZ,             -- Ngày đơn hàng MISA
  platform TEXT,                     -- Sàn (cột D)
  customer TEXT,                     -- Khách hàng
  order_value NUMERIC DEFAULT 0,     -- Giá trị xuất HĐ (cột H)
  ghi_doanh_so TEXT,                 -- Tình trạng ghi doanh số
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_misa_user ON sales.misa_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_misa_order ON sales.misa_orders(user_id, order_id);

ALTER TABLE sales.misa_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "misa_orders_all_own" ON sales.misa_orders;
CREATE POLICY "misa_orders_all_own" ON sales.misa_orders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. INVOICE STATUS - trạng thái HĐ từ file Hóa đơn
CREATE TABLE IF NOT EXISTS sales.invoice_status (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  order_id TEXT NOT NULL,            -- Mã đơn Shopee/TikTok (cột F)
  invoice_no TEXT,                   -- Số hóa đơn (cột C)
  invoice_date TIMESTAMPTZ,          -- Ngày hóa đơn
  invoice_value NUMERIC DEFAULT 0,   -- Giá trị HĐ (cột D)
  platform TEXT,                     -- Sàn (cột E)
  invoice_type TEXT,                 -- Loại HĐ (cột G - "Hóa đơn từ máy tính tiền"...)
  invoice_status TEXT,               -- Trạng thái HĐ (cột H)
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_invstatus_user ON sales.invoice_status(user_id);
CREATE INDEX IF NOT EXISTS idx_invstatus_order ON sales.invoice_status(user_id, order_id);

ALTER TABLE sales.invoice_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_status_all_own" ON sales.invoice_status;
CREATE POLICY "invoice_status_all_own" ON sales.invoice_status
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
