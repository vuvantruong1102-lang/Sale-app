-- ============================================================
-- SCHEMA: SALES MANAGER cho Shopee & TikTok Shop
-- Chạy file này 1 lần trên Supabase SQL Editor
-- ============================================================

-- 1. ORDERS - đơn hàng (1 dòng = 1 SKU trong đơn, đơn nhiều SKU sẽ có nhiều dòng)
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  unique_key TEXT NOT NULL,                 -- order_id + '__' + sku (để upsert)
  order_id TEXT NOT NULL,                   -- Mã đơn hàng
  platform TEXT NOT NULL DEFAULT 'shopee',  -- shopee | tiktok
  package_id TEXT,                          -- Mã kiện hàng
  tracking_no TEXT,                         -- Mã vận đơn
  status TEXT,                              -- Trạng thái
  carrier TEXT,                             -- Đơn vị vận chuyển
  sku TEXT,                                 -- SKU phân loại hàng
  sku_parent TEXT,
  product_name TEXT,
  variation TEXT,
  price_original NUMERIC DEFAULT 0,
  price_deal NUMERIC DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  total_paid NUMERIC DEFAULT 0,             -- Tổng tiền người mua thanh toán
  total_order_value NUMERIC DEFAULT 0,
  shop_voucher NUMERIC DEFAULT 0,
  fee_fix NUMERIC DEFAULT 0,                -- Phí cố định
  fee_service NUMERIC DEFAULT 0,            -- Phí dịch vụ
  fee_payment NUMERIC DEFAULT 0,            -- Phí thanh toán
  date_order TIMESTAMPTZ,
  date_ship TIMESTAMPTZ,
  date_complete TIMESTAMPTZ,
  invoice_issued BOOLEAN DEFAULT FALSE,
  invoice_no TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, unique_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(user_id, date_order DESC);
CREATE INDEX IF NOT EXISTS idx_orders_sku ON orders(user_id, sku);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_orderid ON orders(user_id, order_id);

-- 2. PRODUCTS - sản phẩm + tồn kho
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sku TEXT NOT NULL,                        -- SKU phân loại
  name TEXT NOT NULL,
  variation TEXT,
  stock_initial INTEGER DEFAULT 0,          -- Tồn đầu kỳ
  cost NUMERIC DEFAULT 0,                   -- Giá vốn
  price NUMERIC DEFAULT 0,                  -- Giá bán
  unit TEXT DEFAULT 'cái',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);

-- 3. ADS - chi phí quảng cáo
CREATE TABLE IF NOT EXISTS ads (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sku TEXT,
  product_name TEXT,
  date TIMESTAMPTZ,
  cost NUMERIC DEFAULT 0,                   -- Chi phí QC
  orders_count INTEGER DEFAULT 0,           -- Số đơn từ QC
  revenue NUMERIC DEFAULT 0,                -- Doanh thu QC (GMV)
  imported_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_user ON ads(user_id);
CREATE INDEX IF NOT EXISTS idx_ads_date ON ads(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ads_sku ON ads(user_id, sku);

-- 4. INVOICES - hóa đơn điện tử
CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  invoice_no TEXT,
  order_id TEXT,
  product_name TEXT,
  quantity INTEGER DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  invoice_date TIMESTAMPTZ,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(user_id, order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_no ON invoices(user_id, invoice_no);

-- 5. SETTINGS - cài đặt người dùng
CREATE TABLE IF NOT EXISTS settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  rev_rule TEXT DEFAULT 'shipping',         -- completed | shipping | all_except_cancel
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) - đảm bảo user chỉ thấy data của mình
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Orders policies
DROP POLICY IF EXISTS "orders_select_own" ON orders;
CREATE POLICY "orders_select_own" ON orders FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders_insert_own" ON orders;
CREATE POLICY "orders_insert_own" ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders_update_own" ON orders;
CREATE POLICY "orders_update_own" ON orders FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders_delete_own" ON orders;
CREATE POLICY "orders_delete_own" ON orders FOR DELETE USING (auth.uid() = user_id);

-- Products policies
DROP POLICY IF EXISTS "products_all_own" ON products;
CREATE POLICY "products_all_own" ON products FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Ads policies
DROP POLICY IF EXISTS "ads_all_own" ON ads;
CREATE POLICY "ads_all_own" ON ads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Invoices policies
DROP POLICY IF EXISTS "invoices_all_own" ON invoices;
CREATE POLICY "invoices_all_own" ON invoices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Settings policies
DROP POLICY IF EXISTS "settings_all_own" ON settings;
CREATE POLICY "settings_all_own" ON settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
