-- Thêm cột cho danh sách Hóa đơn ngoài:
--  - is_exported: đã xuất hóa đơn hay chưa (tick)
--  - invoice_no:  số hóa đơn (nhập tay; đơn từ sàn sẽ tự đề xuất từ invoice_status)
alter table sales.external_invoices
  add column if not exists is_exported boolean default false,
  add column if not exists invoice_no text;
