-- ============================================================
-- BẢNG ĐỐI SOÁT TÀI CHÍNH SHOPEE
-- Mỗi dòng = tổng số tiền Shopee thanh toán cho 1 đơn hàng
-- (đã cộng tất cả giao dịch: doanh thu + điều chỉnh +/-)
-- Chạy SQL này trong Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS sales.reconciliation (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  order_id TEXT NOT NULL,             -- Mã đơn hàng (cột D)
  shopee_payout NUMERIC DEFAULT 0,    -- Tổng số tiền Shopee thanh toán cho đơn này
  transaction_count INTEGER DEFAULT 1,-- Số giao dịch đã gộp
  last_transaction_date TIMESTAMPTZ,  -- Ngày giao dịch gần nhất
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_user ON sales.reconciliation(user_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_order ON sales.reconciliation(user_id, order_id);

-- RLS
ALTER TABLE sales.reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reconciliation_all_own" ON sales.reconciliation;
CREATE POLICY "reconciliation_all_own" ON sales.reconciliation
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
