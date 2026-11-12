export interface PaypalTracker { id?: string; status?: string; tracking_number?: string; carrier?: string }

// PayPal's GET order returns trackers as { id, status } only; the id is `<capture_id>-<tracking_number>`.
export function findTracker(trackers: PaypalTracker[], captureId: string, trackingNumber: string, carrier: string): PaypalTracker | undefined {
  return trackers.find((t) => t.id === `${captureId}-${trackingNumber}`)
    ?? trackers.find((t) => t.tracking_number === trackingNumber && t.carrier === carrier);
}
