-- Thêm cột total_fee vào bảng reconciliation để lưu "Tổng phí" từ file Ví TikTok.
-- Mục đích: phí tồn tại độc lập với bảng orders, không bị mất khi xóa/import lại đơn hàng
-- (giống cơ chế shopee_payout / Sàn TT đang hoạt động ổn định).
alter table sales.reconciliation
  add column if not exists total_fee numeric default 0;
