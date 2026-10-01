'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // Tạo 1 QueryClient duy nhất cho mỗi phiên trình duyệt.
  // useState(() => ...) để không khởi tạo lại mỗi lần re-render.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Trong 5 phút, dữ liệu coi như "còn tươi" → chuyển panel KHÔNG fetch lại, hiện ngay từ cache.
            staleTime: 5 * 60 * 1000,
            // Giữ dữ liệu trong cache 30 phút kể cả khi không còn component nào dùng.
            gcTime: 30 * 60 * 1000,
            // Không tự fetch lại khi bấm ra/vào lại tab trình duyệt (tránh giật khi đang xem).
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
