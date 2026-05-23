-- Thêm cột "TT gửi CQT" (cột M file Trạng thái HĐ) vào bảng invoice_status
alter table sales.invoice_status
  add column if not exists cqt_status text;
