-- =====================================================================
-- MIGRATION v7: thêm cột trạng thái đơn hàng (từ sàn)
-- An toàn chạy lại nhiều lần.
-- =====================================================================
alter table wrt_orders add column if not exists order_status text;
