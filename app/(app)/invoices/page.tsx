'use client';

import { useInvoicesData } from '@/lib/queries';
import InvoicesClient from './InvoicesClient';

export default function InvoicesPage() {
  const { data, isLoading, isError, error } = useInvoicesData();

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500">Đang tải dữ liệu hóa đơn…</div>
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
    <InvoicesClient
      initialOrders={data!.orders}
      initialMisa={data!.misa}
      initialInvStatus={data!.invStatus}
      initialExternal={data!.external}
    />
  );
}
