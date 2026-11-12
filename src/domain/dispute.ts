import type { ShippingAddress } from './address.ts';

export interface PayPalDispute {
  dispute_id: string;
  status: string;
  reason?: string;
  seller_response_due_date?: string;
  disputed_transactions?: Array<{ seller_transaction_id?: string }>;
}
export interface StoredOrder {
  id: string;
  capture_id: string | null;
  tracker_id?: string | null;
  tracking_number: string | null;
  carrier: string | null;
  tracker_posted_at: string | null;
  address_json: string | null;
  extraction_json: string | null;
  verdict_json: string | null;
  label_path: string | null;
}
export function matchDisputeToOrder(dispute: PayPalDispute, orders: StoredOrder[]): StoredOrder | undefined {
  const captureIds = new Set((dispute.disputed_transactions ?? []).map((tx) => tx.seller_transaction_id).filter((id): id is string => Boolean(id)));
  return orders.find((order) => Boolean(order.capture_id && captureIds.has(order.capture_id)));
}
export function assembleEvidencePacket(order: StoredOrder, address: ShippingAddress) {
  return {
    orderId: order.id,
    captureId: order.capture_id,
    labelPath: order.label_path,
    tracking: order.tracking_number && order.carrier ? { trackingNumber: order.tracking_number, carrier: order.carrier } : null,
    paypalAddress: address,
    extraction: order.extraction_json ? JSON.parse(order.extraction_json) : null,
    verdict: order.verdict_json ? JSON.parse(order.verdict_json) : null,
    trackerPostedAt: order.tracker_posted_at,
  };
}
