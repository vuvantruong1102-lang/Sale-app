// Tính toán tài chính cho từng dòng đơn hàng — port từ OrdersClient.rowsWithCalc
// Trả về phí Shopee / phí TikTok / doanh thu / giá vốn ĐÚNG như trang Đơn hàng,
// để bảng "Thống kê" lấy phí tự động thay vì nhập tay.
import { Order } from './types';
import { shortStatus } from './utils';

export type Recon = {
  order_id: string;
  shopee_payout?: number | null;
  total_fee?: number | null;
};

export type CalcRow = {
  o: Order;
  quantity: number;
  orderValue: number;
  feeShopee: number;   // phí Shopee (dương)
  feeTikTok: number;   // phí TikTok (dương)
  revenue: number;
  cogs: number;
  isCancelled: boolean;
  isReturned: boolean;
  isMainRow: boolean;
};

export function buildCalcRows(
  orders: Order[],
  products: { sku: string; cost?: number | null }[],
  reconciliation: Recon[]
): CalcRow[] {
  const costMap = new Map<string, number>();
  products.forEach(p => costMap.set(p.sku, p.cost || 0));

  const payoutMap = new Map<string, number>();
  reconciliation.forEach(r => payoutMap.set(r.order_id, r.shopee_payout || 0));

  const reconFeeMap = new Map<string, number>();
  reconciliation.forEach(r => { if (r.total_fee != null) reconFeeMap.set(r.order_id, r.total_fee); });

  const isPlaceholder = (id: string) =>
    !id || /[\s.]/.test(id) || /order id|unique|sku id|product name/i.test(id);
  const cleanOrders = orders.filter(o => !isPlaceholder(String(o.order_id || '').trim()));

  // Dòng chính của mỗi đơn = dòng có giá trị ĐH cao nhất
  const mainRowKey = new Map<string, string>();
  const grouped = new Map<string, Order[]>();
  cleanOrders.forEach(o => {
    const arr = grouped.get(o.order_id) || [];
    arr.push(o);
    grouped.set(o.order_id, arr);
  });
  const orderValueOf = (l: Order) => (l.price_deal || 0) * (l.quantity || 1);
  grouped.forEach((lines, oid) => {
    if (lines.length === 1) { mainRowKey.set(oid, lines[0].unique_key); return; }
    let main = lines[0];
    let maxVal = orderValueOf(main);
    for (const l of lines) {
      const v = orderValueOf(l);
      if (v > maxVal) { main = l; maxVal = v; }
    }
    mainRowKey.set(oid, main.unique_key);
  });

  return cleanOrders.map(o => {
    const price = o.price_deal || 0;
    const quantity = o.quantity || 1;
    const orderValue = price * quantity - (o.shop_voucher || 0);
    const st = shortStatus(o.status || '');

    const isMainRow = mainRowKey.get(o.order_id) === o.unique_key;
    const hasPayout = payoutMap.has(o.order_id);
    const payoutValue = payoutMap.get(o.order_id) || 0;

    const orderFee = (o.fee_fix || 0) + (o.fee_service || 0) + (o.fee_payment || 0);
    const hasReconFee = reconFeeMap.has(o.order_id);
    const rawFee = hasReconFee
      ? (isMainRow ? (reconFeeMap.get(o.order_id) || 0) : 0)
      : (isMainRow ? orderFee : 0);

    const isCancelled = st.text === 'Đã hủy';
    const isCompleted = st.text === 'Hoàn thành' || st.text === 'Đã nhận';
    const isReturned = isCompleted && hasPayout && payoutValue < 0;

    let feeTikTokRaw = 0;
    let feeShopeeRaw = 0;
    if (isReturned) {
      if (o.platform === 'tiktok') feeTikTokRaw = isMainRow ? payoutValue : 0;
      else if (o.platform === 'shopee') feeShopeeRaw = isMainRow ? payoutValue : 0;
    } else if (!isCancelled) {
      if (o.platform === 'tiktok') feeTikTokRaw = rawFee;
      else if (o.platform === 'shopee' && isMainRow && hasPayout) feeShopeeRaw = orderValue - payoutValue;
    }
    const feeTikTok = Math.abs(feeTikTokRaw);
    const feeShopee = Math.abs(feeShopeeRaw);

    let revenue: number;
    if (isReturned) revenue = isMainRow ? payoutValue : 0;
    else if (isCancelled) revenue = isMainRow && hasPayout ? payoutValue : 0;
    else revenue = orderValue - feeTikTokRaw - feeShopeeRaw;

    const cogs = (isReturned || isCancelled) ? 0 : (costMap.get(o.sku || '') || 0) * quantity;

    return {
      o, quantity, orderValue, feeShopee, feeTikTok, revenue, cogs,
      isCancelled, isReturned, isMainRow,
    };
  });
}
