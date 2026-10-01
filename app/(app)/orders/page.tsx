'use client';

import { useState } from 'react';
import { useOrdersData, ORDERS_WINDOW_DAYS as WIN } from '@/lib/queries';
import OrdersClient from './OrdersClient';

export default function OrdersPage() {
  const [fullHistory, setFullHistory] = useState(false);
  const { data, isLoading, isFetching, isError, error } = useOrdersData(fullHistory);

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2 text-xs text-gray-600 border-b bg-gray-50">
        <span>
          {fullHistory
            ? 'Đang hiển thị: tất cả đơn hàng'
            : `Đang hiển thị: đơn trong ${WIN} ngày gần nhất`}
        </span>
        <button
          onClick={() => setFullHistory(v => !v)}
          className="px-2 py-1 rounded border bg-white hover:bg-gray-100"
        >
          {fullHistory ? `Chỉ ${WIN} ngày gần nhất` : 'Xem tất cả'}
        </button>
        {isFetching && <span className="text-gray-400">đang tải…</span>}
      </div>

      {isLoading ? (
        <div className="p-6 text-sm text-gray-500">Đang tải dữ liệu đơn hàng…</div>
      ) : isError ? (
        <div className="p-6 text-sm text-red-600">
          Lỗi tải dữ liệu: {(error as Error)?.message || 'không rõ'}
        </div>
      ) : (
        <OrdersClient
          initialOrders={data!.orders}
          products={data!.products}
          reconciliation={data!.reconciliation as any}
        />
      )}
    </div>
  );
}
