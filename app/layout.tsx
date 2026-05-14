import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quản Lý Bán Hàng - Shopee & TikTok Shop',
  description: 'Hệ thống quản lý bán hàng đa kênh',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
