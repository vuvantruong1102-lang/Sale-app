-- ===============================================
-- Phân hệ Đơn hủy/Trả hàng
-- Chạy trong Supabase SQL Editor
-- ===============================================

-- 1. Thêm 3 cột vào bảng orders để lưu thông tin từ file Shopee
ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS refund_status TEXT,           -- Cột O: Trạng thái Trả hàng/Hoàn tiền
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,           -- Cột F: Lý do hủy
  ADD COLUMN IF NOT EXISTS returned_qty INTEGER DEFAULT 0; -- Cột AB: Số lượng sản phẩm được hoàn trả

-- 2. Bảng returns lưu 2 cột cập nhật bằng tay
CREATE TABLE IF NOT EXISTS sales.returns (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  order_id TEXT NOT NULL,
  shop_received BOOLEAN DEFAULT FALSE,   -- Shop đã nhận hàng hoàn về chưa
  goods_condition TEXT,                  -- Tình trạng hàng hoàn (tự nhập, vd "Còn mới", "Hỏng", ...)
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, order_id)
);

-- RLS
ALTER TABLE sales.returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own returns" ON sales.returns
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own returns" ON sales.returns
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own returns" ON sales.returns
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own returns" ON sales.returns
  FOR DELETE USING (auth.uid() = user_id);

-- Index nhanh tìm theo order_id
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON sales.returns(user_id, order_id);
