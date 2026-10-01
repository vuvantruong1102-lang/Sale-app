'use client';

import { useOrdersData } from '@/lib/queries';
import OrdersClient from './OrdersClient';

export default function OrdersPage() {
  const { data, isLoading, isError, error } = useOrdersData();

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500">Đang tải dữ liệu đơn hàng…</div>
    );
  }
  if (isError) {
    return (
      <div className="p-6 text-sm text-red-600">
        Lỗi tải dữ liệu: {(error as Error)?.message || 'không rõ'}
      </div>
    );
  }

  return (
    <OrdersClient
      initialOrders={data!.orders}
      products={data!.products}
      reconciliation={data!.reconciliation as any}
    />
  );
}
