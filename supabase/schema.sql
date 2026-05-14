-- ============================================================
-- SCHEMA: SALES MANAGER cho Shopee & TikTok Shop
-- Dùng schema riêng 'sales' để tách biệt với các app khác cùng project Supabase
-- Chạy file này 1 lần trên Supabase SQL Editor
-- ============================================================

-- 0. Tạo schema riêng + cấp quyền cho Supabase client (anon, authenticated)
CREATE SCHEMA IF NOT EXISTS sales;
GRANT USAGE ON SCHEMA sales TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA sales TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA sales TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA sales TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 1. ORDERS - đơn hàng (1 dòng = 1 SKU trong đơn, đơn nhiều SKU sẽ có nhiều dòng)
CREATE TABLE IF NOT EXISTS sales.orders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  unique_key TEXT NOT NULL,
  order_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'shopee',
  package_id TEXT,
  tracking_no TEXT,
  status TEXT,
  carrier TEXT,
  sku TEXT,
  sku_parent TEXT,
  product_name TEXT,
  variation TEXT,
  price_original NUMERIC DEFAULT 0,
  price_deal NUMERIC DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  total_paid NUMERIC DEFAULT 0,
  total_order_value NUMERIC DEFAULT 0,
  shop_voucher NUMERIC DEFAULT 0,
  fee_fix NUMERIC DEFAULT 0,
  fee_service NUMERIC DEFAULT 0,
  fee_payment NUMERIC DEFAULT 0,
  date_order TIMESTAMPTZ,
  date_ship TIMESTAMPTZ,
  date_complete TIMESTAMPTZ,
  invoice_issued BOOLEAN DEFAULT FALSE,
  invoice_no TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, unique_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON sales.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON sales.orders(user_id, date_order DESC);
CREATE INDEX IF NOT EXISTS idx_orders_sku ON sales.orders(user_id, sku);
CREATE INDEX IF NOT EXISTS idx_orders_status ON sales.orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_orderid ON sales.orders(user_id, order_id);

-- 2. PRODUCTS - sản phẩm + tồn kho
CREATE TABLE IF NOT EXISTS sales.products (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  variation TEXT,
  stock_initial INTEGER DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  price NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'cái',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_user ON sales.products(user_id);

-- 3. ADS - chi phí quảng cáo
CREATE TABLE IF NOT EXISTS sales.ads (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sku TEXT,
  product_name TEXT,
  date TIMESTAMPTZ,
  cost NUMERIC DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_user ON sales.ads(user_id);
CREATE INDEX IF NOT EXISTS idx_ads_date ON sales.ads(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ads_sku ON sales.ads(user_id, sku);

-- 4. INVOICES - hóa đơn điện tử
CREATE TABLE IF NOT EXISTS sales.invoices (
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
CREATE INDEX IF NOT EXISTS idx_invoices_user ON sales.invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON sales.invoices(user_id, order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_no ON sales.invoices(user_id, invoice_no);

-- 5. SETTINGS - cài đặt người dùng
CREATE TABLE IF NOT EXISTS sales.settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  rev_rule TEXT DEFAULT 'shipping',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE sales.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_own" ON sales.orders;
CREATE POLICY "orders_select_own" ON sales.orders FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders_insert_own" ON sales.orders;
CREATE POLICY "orders_insert_own" ON sales.orders FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders_update_own" ON sales.orders;
CREATE POLICY "orders_update_own" ON sales.orders FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders_delete_own" ON sales.orders;
CREATE POLICY "orders_delete_own" ON sales.orders FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "products_all_own" ON sales.products;
CREATE POLICY "products_all_own" ON sales.products FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ads_all_own" ON sales.ads;
CREATE POLICY "ads_all_own" ON sales.ads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "invoices_all_own" ON sales.invoices;
CREATE POLICY "invoices_all_own" ON sales.invoices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "settings_all_own" ON sales.settings;
CREATE POLICY "settings_all_own" ON sales.settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- ⚠️ QUAN TRỌNG SAU KHI CHẠY SQL NÀY:
-- Vào Supabase Dashboard → Settings → API → "Exposed schemas"
-- → Thêm 'sales' vào danh sách (cách nhau bằng dấu phẩy)
-- VD: public, sales
-- → Save
-- ============================================================
