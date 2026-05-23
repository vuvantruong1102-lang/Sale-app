-- Thêm cột "Tên hóa đơn" cho sản phẩm trong kho.
-- Dùng để tự fill tên mặt hàng khi chọn mã hàng ở trang Hóa đơn ngoài.
alter table sales.products
  add column if not exists invoice_name text;
