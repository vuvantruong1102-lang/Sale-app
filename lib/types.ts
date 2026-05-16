export type Order = {
  id?: number;
  user_id?: string;
  unique_key: string;
  order_id: string;
  platform: 'shopee' | 'tiktok';
  package_id?: string;
  tracking_no?: string;
  status?: string;
  carrier?: string;
  sku?: string;
  sku_parent?: string;
  product_name?: string;
  variation?: string;
  price_original?: number;
  price_deal?: number;
  quantity?: number;
  total_paid?: number;
  total_order_value?: number;
  shop_voucher?: number;
  fee_fix?: number;
  fee_service?: number;
  fee_payment?: number;
  date_order?: string | null;
  date_ship?: string | null;
  date_complete?: string | null;
  invoice_issued?: boolean;
  invoice_no?: string;
  // Phân hệ Đơn hủy/Trả hàng
  refund_status?: string;     // Trạng thái Trả hàng/Hoàn tiền (cột O Shopee)
  cancel_reason?: string;     // Lý do hủy (cột F Shopee)
  returned_qty?: number;      // Số lượng sản phẩm được hoàn trả (cột AB Shopee)
};

export type Return = {
  id?: number;
  user_id?: string;
  order_id: string;
  shop_received?: boolean;
  goods_condition?: string;
  note?: string;
};

export type Product = {
  id?: number;
  user_id?: string;
  sku: string;
  name: string;
  variation?: string;
  stock_initial?: number;
  cost?: number;
  price?: number;
  unit?: string;
};

export type Ad = {
  id?: number;
  user_id?: string;
  sku?: string;
  product_name?: string;
  date?: string | null;
  cost?: number;
  orders_count?: number;
  revenue?: number;
};

export type Invoice = {
  id?: number;
  user_id?: string;
  invoice_no?: string;
  order_id?: string;
  product_name?: string;
  quantity?: number;
  unit_price?: number;
  total_amount?: number;
  invoice_date?: string | null;
};

export type Settings = {
  user_id?: string;
  rev_rule: 'completed' | 'shipping' | 'all_except_cancel';
};
