# Quản Lý Bán Hàng Shopee & TikTok Shop

Web app quản lý bán hàng đa kênh: Dashboard, Đơn hàng, Tồn kho, Quảng cáo, Hóa đơn, Lỗ lãi.

**Stack:** Next.js 14 (App Router) + Supabase (Auth + Postgres + RLS) + Tailwind CSS

---

## 1. Cài đặt local

```bash
npm install
```

## 2. Cấu hình Supabase

### Bước 2.1 — Tạo `.env.local`

Copy `.env.example` thành `.env.local` và điền 2 giá trị từ Supabase Dashboard (Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

### Bước 2.2 — Tạo bảng trong Supabase

Vào **SQL Editor** trên Supabase Dashboard → New query → paste toàn bộ file `supabase/schema.sql` → Run.

Schema sẽ tạo 5 bảng: `orders`, `products`, `ads`, `invoices`, `settings` cùng với Row Level Security (RLS) đảm bảo mỗi user chỉ thấy data của mình.

### Bước 2.3 — Tắt email confirmation (tùy chọn, để vào ngay không cần xác thực)

**Authentication → Providers → Email** → tắt "Confirm email" → Save.

## 3. Chạy local

```bash
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000) → đăng ký tài khoản → bắt đầu dùng.

## 4. Deploy lên Vercel

1. Push code lên GitHub
2. Vercel → New Project → Import repo
3. Trong "Environment Variables" thêm 2 biến `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy

---

## Hướng dẫn sử dụng

### Tab Đơn hàng — Import file Shopee/TikTok

1. Bấm **"Import file đơn hàng"**, chọn file `.xlsx` Shopee xuất ra (như file `Order_all_20260501_20260514.xlsx`)
2. Phần mềm tự nhận diện platform theo tên file (chứa "tiktok" → TikTok, còn lại → Shopee)
3. Import nhiều lần: đơn cũ tự update các thông tin mới, đơn mới được thêm vào
4. SKU mới tự đồng bộ sang Hàng tồn kho với giá vốn = 0 (cần nhập sau)

### Tab Hàng tồn kho — Nhập giá vốn

Sau khi import đơn hàng lần đầu, vào tab **Hàng tồn kho**, bấm **"Sửa"** từng SKU để nhập:
- Tồn kho ban đầu
- Giá vốn (quan trọng để tính lợi nhuận)
- Giá bán niêm yết

### Tab Quảng cáo — Import file QC

File QC cần có các cột (tên tương tự): `SKU`, `Tên sản phẩm`, `Ngày`, `Chi phí`, `Đơn hàng`, `Doanh thu`.

### Tab Hóa đơn — Đối chiếu với cơ quan thuế

File HĐ cần có: `Số HĐ`, `Mã đơn hàng`, `Tên sản phẩm`, `Số lượng`, `Đơn giá`, `Thành tiền`, `Ngày xuất`.

Tab **"Đơn chưa xuất HĐ"** hiển thị các đơn còn sót, giúp không quên gửi cơ quan thuế.

### Tab Lỗ lãi

Xem theo **Ngày / Tháng / Năm / Mặt hàng**. Lợi nhuận = Doanh thu - Giá vốn - Phí sàn - Phí QC.

### Tab Cài đặt

Chọn "Quy tắc tính doanh thu" để xác định đơn nào tính vào doanh thu (chỉ đơn hoàn thành, hay cả đang giao, hay tất cả trừ đã hủy).

---

## Cấu trúc thư mục

```
sales-app/
├── app/
│   ├── (app)/              # Route group cho các trang đã login
│   │   ├── dashboard/
│   │   ├── orders/
│   │   ├── inventory/
│   │   ├── ads/
│   │   ├── invoices/
│   │   ├── profit/
│   │   ├── settings/
│   │   └── layout.tsx      # Sidebar + auth check
│   ├── login/              # Trang login/đăng ký
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Redirect → /dashboard
│   └── globals.css
├── components/
│   └── Sidebar.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts       # Browser client
│   │   ├── server.ts       # Server client
│   │   └── middleware.ts   # Session refresh
│   ├── types.ts
│   └── utils.ts            # Formatter, parser, column mapping
├── supabase/
│   └── schema.sql          # Schema + RLS policies
├── middleware.ts           # Route protection
├── tailwind.config.js
├── next.config.js
└── package.json
```
