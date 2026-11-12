import type { ShippingAddress } from './address.ts';
import type { StoredOrder } from './dispute.ts';

// What Postmark can honestly say to PayPal about a dispute, decided by code from stored evidence only.
export const ITEM_NOT_RECEIVED = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
const REASON_LABELS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Item not as described',
  UNAUTHORISED: 'Unauthorised transaction',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate transaction',
  INCORRECT_AMOUNT: 'Incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Cancelled recurring billing',
  PROBLEM_WITH_REMITTANCE: 'Problem with remittance',
  OTHER: 'Other',
};
export const disputeReasonLabel = (reason?: string | null) => (reason && REASON_LABELS[reason]) || reason || 'Reason not given';

export interface DisputeLike {
  dispute_id: string;
  status: string;
  reason?: string | null;
  disputed_transactions?: Array<{ seller_transaction_id?: string }>;
  links?: Array<{ rel?: string; method?: string }>;
}
export type AnswerDecision = 'SUBMIT' | 'HOLD' | 'SKIP';
export type ProtectionClaim = 'PROTECTED' | 'AT RISK' | 'SHIPPED ANYWAY' | 'NO LABEL CHECK';
export interface AnswerPlan {
  decision: AnswerDecision;
  protection: ProtectionClaim;
  reasons: string[];
  evidenceType: 'PROOF_OF_FULFILLMENT' | 'OTHER';
  canSubmitManually: boolean;
  included: {
    labelPhoto: boolean;
    labelRead: { carrier: string | null; trackingNumber: string | null; recipient: string | null; confidence: number | null } | null;
    verdict: { state: string; addressDifferences: Array<{ field: string; paypal: string; label: string }>; trackingValid: boolean | null } | null;
    tracking: { carrier: string; trackingNumber: string } | null;
    trackerId: string | null;
    trackerPostedAt: string | null;
    paypalAddress: ShippingAddress | null;
  };
  notes: string;
}

const terminal = (status: string) => /RESOLVED|CLOSED/i.test(status);
const sellerAsked = (dispute: DisputeLike) => {
  const links = dispute.links ?? [];
  if (links.length) return links.some((link) => link.rel === 'provide_evidence');
  return dispute.status === 'WAITING_FOR_SELLER_RESPONSE';
};
const fieldLabel = (field: string) => ({ street: 'street', unit: 'unit', line2: 'address line 2', city: 'city', state: 'state', postal: 'ZIP code', country: 'country' } as Record<string, string>)[field] ?? field;
const oneLine = (address: ShippingAddress | null) => address ? [address.address_line_1, address.address_line_2, address.city, [address.state, address.postal_code].filter(Boolean).join(' '), address.country_code].filter(Boolean).join(', ') : '';

export function planDisputeAnswer(dispute: DisputeLike, order: StoredOrder | undefined, options: { hasLabelFile: boolean }): AnswerPlan {
  const verdict = order?.verdict_json ? JSON.parse(order.verdict_json) as { state: string; addressDifferences?: Array<{ field: string; paypal: string; label: string }>; trackingValid?: boolean } : null;
  const extraction = order?.extraction_json ? JSON.parse(order.extraction_json) as Record<string, any> : null;
  const address = order?.address_json ? JSON.parse(order.address_json) as ShippingAddress : null;
  const tracking = order?.tracking_number && order.carrier ? { carrier: order.carrier, trackingNumber: order.tracking_number } : null;
  const trackerId = order?.tracker_id ?? null;
  const protection: ProtectionClaim = !verdict ? 'NO LABEL CHECK' : verdict.state === 'PROTECTED' ? 'PROTECTED' : trackerId ? 'SHIPPED ANYWAY' : 'AT RISK';
  const isInr = dispute.reason === ITEM_NOT_RECEIVED;
  const included: AnswerPlan['included'] = {
    labelPhoto: Boolean(order?.label_path) && options.hasLabelFile,
    labelRead: extraction ? { carrier: extraction.carrier ?? null, trackingNumber: extraction.tracking_number ?? null, recipient: extraction.recipient_name ?? null, confidence: typeof extraction.confidence === 'number' ? extraction.confidence : null } : null,
    verdict: verdict ? { state: verdict.state, addressDifferences: verdict.addressDifferences ?? [], trackingValid: verdict.trackingValid ?? null } : null,
    tracking, trackerId, trackerPostedAt: order?.tracker_posted_at ?? null, paypalAddress: address,
  };
  const base = { protection, included, evidenceType: (isInr ? 'PROOF_OF_FULFILLMENT' : 'OTHER') as AnswerPlan['evidenceType'] };
  if (!order) {
    const capture = dispute.disputed_transactions?.[0]?.seller_transaction_id;
    return { ...base, decision: 'SKIP', canSubmitManually: false, reasons: [`No Postmark order matches PayPal capture ${capture ?? '(none on the dispute)'}.`], notes: '' };
  }
  if (terminal(dispute.status)) return { ...base, decision: 'SKIP', canSubmitManually: false, reasons: [`PayPal shows this dispute as ${dispute.status}.`], notes: '' };

  const reasons: string[] = [];
  const asked = sellerAsked(dispute);
  if (!asked) reasons.push(`PayPal is not asking the seller for evidence right now (status ${dispute.status}).`);
  if (!isInr) reasons.push(`The buyer's reason is "${disputeReasonLabel(dispute.reason)}". Proof of shipment answers item-not-received only, so the seller has to respond to this one.`);
  if (protection === 'NO LABEL CHECK') reasons.push('No label check is recorded for this order, so Postmark has no address match to show.');
  if (protection === 'AT RISK') reasons.push('The label did not match the PayPal shipping address. Postmark does not claim Seller Protection for this parcel.');
  if (protection === 'SHIPPED ANYWAY') reasons.push('The seller shipped with a label that did not match the PayPal shipping address ("ship anyway"). Postmark does not claim Seller Protection for this parcel.');
  if (!tracking) reasons.push('No carrier and tracking number are stored for this order.');
  else if (!trackerId) reasons.push('Tracking was never posted to the PayPal order.');
  if (!included.labelPhoto) reasons.push('No label photo is stored for this order.');

  const notes = draftNotes(order.id, protection, included, address);
  const canSubmitManually = asked && Boolean(tracking) && included.labelPhoto;
  return { ...base, decision: reasons.length ? 'HOLD' : 'SUBMIT', canSubmitManually, reasons, notes };
}

// Deterministic seller notes: only stored facts, and a mismatch is stated rather than hidden.
function draftNotes(orderId: string, protection: ProtectionClaim, included: AnswerPlan['included'], address: ShippingAddress | null) {
  if (!included.tracking) return '';
  const lines = [`Shipped with ${included.tracking.carrier} tracking ${included.tracking.trackingNumber}.`];
  if (included.labelPhoto) lines.push('A photo of the shipping label, taken before drop-off, is attached.');
  if (protection === 'PROTECTED') lines.push(`The label's recipient address matches the PayPal shipping address for this transaction field by field: ${oneLine(address)}.`);
  else if (included.verdict?.addressDifferences.length) {
    const diff = included.verdict.addressDifferences.map((item) => `${fieldLabel(item.field)} on the label "${item.label}", PayPal shipping address "${item.paypal}"`).join('; ');
    lines.push(`The label differs from the PayPal shipping address: ${diff}.`);
  }
  if (included.trackerId) lines.push(`Tracking was added to PayPal order ${orderId}${included.trackerPostedAt ? ` on ${included.trackerPostedAt}` : ''} (tracker ${included.trackerId}).`);
  return lines.join(' ');
}

export function evidenceInput(plan: AnswerPlan, notes: string) {
  if (!plan.included.tracking) throw new Error('No carrier and tracking number to submit.');
  return {
    evidences: [{
      evidence_type: plan.evidenceType,
      evidence_info: { tracking_info: [{ carrier_name: plan.included.tracking.carrier, tracking_number: plan.included.tracking.trackingNumber }] },
      notes: notes.trim(),
    }],
  };
}
